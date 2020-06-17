import './../public/style.css';
import {
  AREA_SHIFT,
  ASSIGNED_STAFF,
  BLOCK_LEVELS, BLOCK_TYPES, BORDER_WIDTH,
  BOTTOM, GOVERNANCE, H_BLOCK_PADDING,
  H_SPACE_BETWEEN_BLOCKS, LEFT,
  LEVEL_WIDTH_STEP, MIN_BLOCK_WIDTH, ORG_UNIT, POSITION, RIGHT, STRUCTURAL_UNIT, TOP,
  V_SPACE_BETWEEN_BLOCKS,
} from './constants';
import {MIN_BLOCK_HEIGHT} from './constants';
import {IND_HEIGHT} from './constants';
import {
  appendBlock, createLine, createStampBlock,
  createUpsideDownConnector,
  getBlockParams, getDataFromDOM, getFullHeight,
} from './utils';
import FileSaver from 'file-saver';
import 'canvas-toBlob';

// Инициализация отрисовки схемы
let maxInlineCount = 100;
export const drawScheme = () => {
  const blocksMap = new Map();
  const blockParamsMap = new Map();
  const linesMap = new Map();
  const orgUnitAreasMap = new Map();
  const assignedStaffAreasMap = new Map();
  const structuralUnitAreasMap = new Map();

  const root = document.getElementById('root');

  let {ofmDataStr, ofmTitle, ofmStampStr, maxDepth, drawSeparators, saveToDom, toImage, toPdf, deleteTechBlock} = getDataFromDOM();

  if (! maxDepth) {
    maxDepth = 1;
  }

  if (!ofmDataStr) {
    return;
  }

  const ofmData = JSON.parse(ofmDataStr.trim().replace(new RegExp('[\\n]+\\s\\s+', 'g'), ''));
  const parent = ofmData[0];
  if (deleteTechBlock) {
    const techBlockDiv = document.getElementById('techBlock');
    techBlockDiv.parentNode.removeChild(techBlockDiv);
  }

  const parentWidth = MIN_BLOCK_WIDTH + LEVEL_WIDTH_STEP * maxDepth;
  const parY = 20;
  const parentBlock = appendBlock(20, parY, parentWidth, MIN_BLOCK_HEIGHT, parent, blocksMap, blockParamsMap, {top: {y: 0}});

  // отрисовка штампа схемы
  let stampBlock;
  if (ofmStampStr) {
    const ofmStamp = JSON.parse(ofmStampStr.trim().replace(new RegExp('[\\n]+\\s\\s+', 'g'), ''));
    stampBlock = drawStamp(ofmStamp, parentWidth);

    if (parentBlock.children[0].clientHeight + parY < stampBlock.bottom) {
      parentBlock.style.top = `${stampBlock.bottom - 2 * parY}px`;
      blockParamsMap.set(parent.id, getBlockParams(parentBlock, parent, 0));
      parentBlockParams = blockParamsMap.get(parent.id);
    }
  }

  // отрисовка первого уровня
  let parentBlockParams = blockParamsMap.get(parent.id);
  if (parent.type === BLOCK_TYPES.leadership) {
    maxInlineCount = 3;
    drawFirstRow(blocksMap, blockParamsMap, parent, parentBlockParams);
  }

  // отрисовка вертикально-расположенных блоков
  drawColumns(blocksMap, blockParamsMap, orgUnitAreasMap, assignedStaffAreasMap, structuralUnitAreasMap, parent);

  // общая ширина схемы определяется по правой точке последнего блока
  let fullWidth = 0;
  let fullHeight;
  if (!parent.children.length) {
    fullHeight = parentBlockParams.bottom + IND_HEIGHT;
    fullWidth = screen.width;
  } else {
    parent.children.forEach((child) => {
      const childBlockParams = blockParamsMap.get(child.id);
      if (childBlockParams.right.x > fullWidth) {
        fullWidth = childBlockParams.right.x;
      }
    });

    // общая высота схемы определяется по нижней точке областей отрисовки (ОЕ, приписной штат, СП)
    if (structuralUnitAreasMap.size) {
      fullHeight = getFullHeight(structuralUnitAreasMap);
    } else if (assignedStaffAreasMap.size) {
      fullHeight = getFullHeight(assignedStaffAreasMap);
    } else if (orgUnitAreasMap.size) {
      fullHeight = getFullHeight(orgUnitAreasMap);
    } else {
      fullHeight = getFullHeight(blockParamsMap) + IND_HEIGHT + parY;
    }
  }

  // итоговое выравнивание корневого элемента по общей ширине схемы
  const oldParentBlockLeft = parseInt(parentBlock.style.left);
  const newParentBlockLeft = fullWidth / 2 - parentWidth / 2;
  if (ofmStampStr) {
    let newStampBlockLeft = fullWidth - parseInt(stampBlock.style.width) - 10;
    if (newStampBlockLeft < newParentBlockLeft + parentWidth + 50) {
      newStampBlockLeft = newParentBlockLeft + parentWidth + 50;
    }
    stampBlock.style.left = `${newStampBlockLeft}px`;
  }
  parentBlock.style.left = `${newParentBlockLeft}px`;
  blockParamsMap.set(parent.id, getBlockParams(parentBlock, parent, 0));
  parentBlockParams = blockParamsMap.get(parent.id);
  // если для вывода выбран не корневой блок, а блок заместителя,
  // сдвигаются подлежащие заместители
  if (parent.type === BLOCK_TYPES.deputy) {
    const secondLevelBlockLeftShift = newParentBlockLeft - oldParentBlockLeft;
    parent.children.forEach((child) => {
      if (child.otype === POSITION && child.level === BLOCK_LEVELS.second) {
        const childSecondLevelBlock = blocksMap.get(child.id);
        childSecondLevelBlock.style.left = `${parseInt(childSecondLevelBlock.style.left) + secondLevelBlockLeftShift}px`;
        blockParamsMap.set(child.id, getBlockParams(childSecondLevelBlock, child, parentBlockParams.top.y));
      }
    });
  }

  // отрисовка соединяющих линий
  if (parent.type === BLOCK_TYPES.leadership) {
    parent.children.forEach((child) => {
      const childBlockParams = blockParamsMap.get(child.id);
      createUpsideDownConnector(root, linesMap, undefined, parentBlockParams, childBlockParams, BOTTOM, TOP);
      drawConnectors(linesMap, blockParamsMap, orgUnitAreasMap, assignedStaffAreasMap, child, parent);
    });
  } else {
    drawConnectors(linesMap, blockParamsMap, orgUnitAreasMap, assignedStaffAreasMap, parent, parent);
  }

  // отрисовка линий координации

  // отрисовка разеделителей областей с приписным штатом/ структурными подразделениями
  if (drawSeparators) {
    drawAreaSeparator(assignedStaffAreasMap, fullWidth);
    drawAreaSeparator(structuralUnitAreasMap, fullWidth);
  }

  // сохранение разметки
  if (saveToDom) {
    saveBlockParamsMapToDOM();
  }

  // формирование канвы для получения изображения
  if (toImage) {
    translateHTMLToCanvasToImage(document.body, ofmTitle, fullWidth, fullHeight, blocksMap, blockParamsMap, linesMap);
  }

  if (toPdf) {

  }
};

/**
 * Отрисовка блоков с единицами управления
 * @param {Map} blocksMap
 * @param {Map} blockParamsMap
 * @param {Object} parent
 * @param {Object} parentParams
 */
const drawFirstRow = (blocksMap, blockParamsMap, parent, parentParams) => {
  let maxHeight = MIN_BLOCK_HEIGHT;
  let newHeight = MIN_BLOCK_HEIGHT;

  const width = parentParams.width - LEVEL_WIDTH_STEP;
  const height = MIN_BLOCK_HEIGHT;
  let x = H_SPACE_BETWEEN_BLOCKS;
  const y = parentParams.bottom.y + V_SPACE_BETWEEN_BLOCKS + IND_HEIGHT;

  parent.children.forEach((child) => {
    const childBlock = appendBlock(x, y, width, height, child, blocksMap, blockParamsMap, parentParams, true);
    const childHeight = parseInt(childBlock.children[0].clientHeight);
    const borderWidth = parseInt(childBlock.children[0].style.borderWidth);

    if (childHeight > maxHeight) {
      maxHeight = childHeight;
      newHeight = childHeight;
    }
    x += width + H_BLOCK_PADDING + borderWidth * 2 + H_SPACE_BETWEEN_BLOCKS;
  });

  if (maxHeight > height) {
    maxHeight += IND_HEIGHT;
  } else {
    maxHeight = height;
  }

  // пересчет высоты блоков и добавление в глобальный map
  parent.children.filter((elem) => elem.additionalInfo === GOVERNANCE).forEach((child) => {
    const childBlock = blocksMap.get(child.id);
    const indicatorBlockTop = newHeight + parseInt(childBlock.children[0].style.borderWidth, 10) * 2;
    childBlock.style.height = maxHeight + 'px';
    childBlock.children[0].style.height = newHeight + 'px';
    childBlock.children[1].style.top = indicatorBlockTop + 'px';
    blocksMap.set(child.id, childBlock);
    blockParamsMap.set(child.id, getBlockParams(childBlock, child, parentParams.top.y));
  });
};

/**
 * Отрисовка блоков схемы, которые выводятся вертикально
 * @param {Map} blocksMap
 * @param {Map} blockParamsMap
 * @param {Map} orgUnitAreasMap
 * @param {Map} assignedStaffAreasMap
 * @param {Map} structuralUnitAreasMap
 * @param {Object} parent
 */
const drawColumns = (blocksMap, blockParamsMap, orgUnitAreasMap, assignedStaffAreasMap, structuralUnitAreasMap, parent) => {
  let nextShift = 0;
  let lastRightPoint = 0;
  let shiftsCount = 0;
  let maxAssignedStaffVerticalShift = 0;
  let maxStructuralUnitsVerticalShift = 0;
  let columns = [];
  if (parent.type === BLOCK_TYPES.leadership) {
    columns = parent.children;
  } else {
    columns = [parent];
  }
  columns.forEach((child) => {
    // сдвиг блока вправо
    if (nextShift) {
      const childBlock = blocksMap.get(child.id);
      const childBlockParams = blockParamsMap.get(child.id);
      childBlock.style.left = `${childBlockParams.x + nextShift - childBlockParams.width * shiftsCount}px`;
      blockParamsMap.set(child.id, getBlockParams(childBlock, child, childBlockParams.nearParentTop, childBlockParams.isRootChild));
      lastRightPoint = 0;
    }
    let childBlockParams = blockParamsMap.get(child.id);

    // отрисовка блоков орг. единиц
    const orgUnitArea = {};
    const shift = drawOrgUnits(blocksMap, blockParamsMap, orgUnitArea, child, childBlockParams);
    if (Object.entries(orgUnitArea).length && orgUnitArea.height) {
      orgUnitAreasMap.set(child.id, orgUnitArea);
    }

    // если есть заместители у ШД (S -> S), то отрисовываются их блоки
    if (child.otype === POSITION) {
      childBlockParams = blockParamsMap.get(child.id);
      const {deputyVerticalShift, deputyRightPoint} = drawDeputy(blocksMap, blockParamsMap, child, childBlockParams);
      lastRightPoint = deputyRightPoint;
      // если заместители по высоте превышают допустимый лимит, то требуется
      // сдвинуть нижележащие блоки орг. единиц
      if (deputyVerticalShift) {
        shiftOrgUnitsDown(child, blocksMap, blockParamsMap, deputyVerticalShift);
        if (Object.entries(orgUnitArea).length) {
          orgUnitArea.y += deputyVerticalShift;
        }
      }
    }

    // отрисовка блоков с приписным штатом
    const orgUnitAreaBottom = orgUnitArea.y + orgUnitArea.height;
    if (maxAssignedStaffVerticalShift < orgUnitAreaBottom) {
      maxAssignedStaffVerticalShift = orgUnitAreaBottom;
    }
    const assignedStaffArea = {};
    drawOtherUnits(blocksMap, blockParamsMap, orgUnitArea, assignedStaffArea, child, childBlockParams, ASSIGNED_STAFF);
    if (Object.entries(assignedStaffArea).length && assignedStaffArea.height) {
      assignedStaffAreasMap.set(child.id, assignedStaffArea);
    }

    // отрисовка блоков со структурными подразделениями
    let prevAreaBottom;
    if (assignedStaffArea.height) {
      prevAreaBottom = assignedStaffArea.y + assignedStaffArea.height;
    } else {
      prevAreaBottom = orgUnitAreaBottom;
    }
    if (maxStructuralUnitsVerticalShift < prevAreaBottom) {
      maxStructuralUnitsVerticalShift = prevAreaBottom;
    }
    const prevArea = assignedStaffArea.width ? assignedStaffArea : orgUnitArea;
    const structuralUnitArea = {};
    drawOtherUnits(blocksMap, blockParamsMap, prevArea, structuralUnitArea, child, childBlockParams, STRUCTURAL_UNIT);
    if (Object.entries(structuralUnitArea).length && structuralUnitArea.height) {
      structuralUnitAreasMap.set(child.id, structuralUnitArea);
    }

    // сдвиг следующих блоков определяется блоками сдочерними ОЕ, либо блоками с заместителями
    if (shift[0] || lastRightPoint) {
      let deputyShift;
      if (Object.entries(orgUnitArea).length) {
        deputyShift = lastRightPoint - orgUnitArea.x;
      } else {
        childBlockParams = blockParamsMap.get(child.id);
        deputyShift = lastRightPoint - lastRightPoint - childBlockParams.left.x;
      }

      if (deputyShift > shift[0]) {
        nextShift += deputyShift;
      } else {
        nextShift += shift[0];
      }
      shiftsCount++;
    }
  });

  // сдвиг блоков приписного штата вниз
  shiftOtherUnitsDown(blocksMap, blockParamsMap, ASSIGNED_STAFF, maxAssignedStaffVerticalShift);
  assignedStaffAreasMap.forEach((area) => {
    area.y = maxAssignedStaffVerticalShift;
  });

  // сдвиг блоков структурных подразделений вниз
  shiftOtherUnitsDown(blocksMap, blockParamsMap, STRUCTURAL_UNIT, maxStructuralUnitsVerticalShift);
  structuralUnitAreasMap.forEach((area) => {
    area.y = maxStructuralUnitsVerticalShift;
  });
};

/**
 * Отрисовка заместителей для ШД(s->s)
 * @param {Map} blocksMap
 * @param {Map} blockParamsMap
 * @param {Object} parent
 * @param {Object} parentParams
 * @return {Object}
 */
const drawDeputy = (blocksMap, blockParamsMap, parent, parentParams) => {
  const positions = parent.children.filter((child) => child.otype === POSITION);
  const positionsLength = positions.length;
  if (!positionsLength) {
    return {};
  }

  const width = parentParams.width - LEVEL_WIDTH_STEP;
  const height = MIN_BLOCK_HEIGHT;

  const x = parentParams.right.x + parentParams.borderWidth + H_SPACE_BETWEEN_BLOCKS;
  let y = parentParams.y;

  positions.forEach((child) => {
    appendBlock(x, y, width, height, child, blocksMap, blockParamsMap, parentParams);

    y = blockParamsMap.get(child.id).bottom.y + IND_HEIGHT + V_SPACE_BETWEEN_BLOCKS;
  });

  const lastChildParams = blockParamsMap.get(positions[positionsLength - 1].id);
  // у блоков с заместителями заместителей нет индикаторов, поэтому берется разница между
  // нижними точками блоков
  const verticalDiff = lastChildParams.bottom.y - parentParams.bottom.y;
  const deputyVerticalShift = verticalDiff > 0 ? verticalDiff : 0;

  // крайняя правая точка после отрисовки заместителей
  const deputyRightPoint = lastChildParams.right.x + lastChildParams.borderWidth;

  return {deputyVerticalShift, deputyRightPoint};
};

/**
 * Отрисовка блоков с орг.единицами ОФМ
 * @param {Map} blocksMap
 * @param {Map} blockParamsMap
 * @param {Object} orgUnitArea
 * @param {Object} parent
 * @param {Object} parentParams
 * @return {Array} verticalShift
 */
const drawOrgUnits = (blocksMap, blockParamsMap, orgUnitArea, parent, parentParams,) => {
  const orgUnits = parent.children.filter((child) => child.otype === ORG_UNIT && (!child.additionalInfo || child.additionalInfo === GOVERNANCE));
  const childrenCount = orgUnits.length;
  if (childrenCount === 0) {
    orgUnitArea.x = parentParams.x;
    orgUnitArea.y = parentParams.bottom.y + V_SPACE_BETWEEN_BLOCKS + IND_HEIGHT;
    orgUnitArea.width = 0;
    orgUnitArea.height = 0;
    return [0, 0];
  }

  let childrenDrawnInline = false;
  let childrenInlineCount = 0;
  let inlineMaxVerticalShift = 0;

  const width = parentParams.width - LEVEL_WIDTH_STEP;
  const height = MIN_BLOCK_HEIGHT;

  const initX = parentParams.x + LEVEL_WIDTH_STEP / 2 + parentParams.borderWidth;
  let x = initX;
  let y = parentParams.bottom.y + V_SPACE_BETWEEN_BLOCKS + IND_HEIGHT;

  if ((parent.otype === POSITION) && (parent.level) === BLOCK_LEVELS.second && childrenCount > 1) {
    childrenDrawnInline = true;
  }

  orgUnits.forEach((child) => {
    appendBlock(x, y, width, height, child, blocksMap, blockParamsMap, parentParams);

    // отрисовка потомков
    const shift = drawOrgUnits(blocksMap, blockParamsMap, orgUnitArea, child, blockParamsMap.get(child.id));

    const childBlockParams = blockParamsMap.get(child.id);
    if (!childrenDrawnInline) {
      if (!shift[1]) {
        y = childBlockParams.bottom.y + IND_HEIGHT + V_SPACE_BETWEEN_BLOCKS;
      } else {
        y = shift[1];
      }
    } else {
      // если у ШД 1/2 уровня есть несколько потомков, то их необходимо выводить в несколько стобцов
      // при этом требуется сдвинуть блок с самой ШД, а также следующие блоки с ШД
      if (shift[1] > inlineMaxVerticalShift) {
        inlineMaxVerticalShift = shift[1];
      }
      childrenInlineCount++;
      // в один ряд выводится не больше n блоков

      if (childrenInlineCount < maxInlineCount) {
        x = childBlockParams.right.x + H_SPACE_BETWEEN_BLOCKS;
      } else {
        x = initX;
        y = inlineMaxVerticalShift;
        childrenInlineCount = 0;
        inlineMaxVerticalShift = 0;
      }
    }
  });

  // если дочерние блоки необходимо вывести в одну строку, то необходимо сместить родительский блок
  // и все следующие
  let retHorizontalShift = 0;
  if (childrenDrawnInline) {
    if (childrenCount < maxInlineCount) {
      childrenInlineCount = childrenCount;
    } else {
      childrenInlineCount = maxInlineCount;
    }
    const childrenWidth = blockParamsMap.get(orgUnits[0].id).width * childrenInlineCount + H_SPACE_BETWEEN_BLOCKS * (childrenInlineCount);
    const parentBlock = blocksMap.get(parent.id);
    // TODO тоже дичь
    parentBlock.style.left = `${parentParams.x + (childrenWidth - H_SPACE_BETWEEN_BLOCKS) / 2 - parentParams.width / 2 + LEVEL_WIDTH_STEP / 2}px`;
    blockParamsMap.set(parent.id, getBlockParams(parentBlock, parent, parentParams.nearParentTop));
    retHorizontalShift = childrenWidth;
  }

  // область с орг. единицами
  // TODO продумать условие для определения именно ВТОРОГО уровня для ШД
  if (parent.otype === POSITION && childrenCount) {
    const leftChildBlock = blockParamsMap.get(orgUnits[0].id);
    orgUnitArea.x = leftChildBlock.x;
    orgUnitArea.y = leftChildBlock.y;
    y = inlineMaxVerticalShift;

    orgUnitArea.height = y - orgUnitArea.y + IND_HEIGHT + AREA_SHIFT;

    if (!childrenDrawnInline) {
      orgUnitArea.width = leftChildBlock.width;
    } else {
      const rightChildBlock = blockParamsMap.get(orgUnits[childrenInlineCount - 1].id);
      orgUnitArea.width = rightChildBlock.right.x - orgUnitArea.x;
    }
  }

  // TODO возвращать не массив, а объект?
  return [retHorizontalShift, y];
};

/**
 * Отрисовка блоков с приписным штатом
 * @param {Map} blocksMap
 * @param {Map} blockParamsMap
 * @param {Object} prevArea
 * @param {Object} unitsArea
 * @param {Object} parent
 * @param {Object} parentParams
 * @param {String} additionalInfo
 * @return {Array}
 */
const drawOtherUnits = (blocksMap, blockParamsMap, prevArea, unitsArea, parent, parentParams, additionalInfo) => {
  const units = parent.children.filter((child) => child.otype === ORG_UNIT && child.additionalInfo === additionalInfo);
  const childrenCount = units.length;
  if (childrenCount === 0) {
    return [0, 0];
  }
  const width = parentParams.width - LEVEL_WIDTH_STEP;
  const height = MIN_BLOCK_HEIGHT;

  // TODO оставил для последующей модификации по вывод приписного штата и сп в несколько колонок
  let initX;
  let y;
  let parentTop;
  if (!parent.additionalInfo || parent.additionalInfo === GOVERNANCE) {
    initX = prevArea.x;
    y = prevArea.y + prevArea.height;
    parentTop = {top: {y: y}};
  } else {
    initX = parentParams.x + LEVEL_WIDTH_STEP / 2 + parentParams.borderWidth + 5;
    y = parentParams.bottom.y + V_SPACE_BETWEEN_BLOCKS + IND_HEIGHT;
    parentTop = {top: {y: parentParams.nearParentTop}};
  }
  const x = initX;

  units.forEach((child) => {
    appendBlock(x, y, width, height, child, blocksMap, blockParamsMap, parentTop);
    // отрисовка потомков
    const shift = drawOtherUnits(blocksMap, blockParamsMap, prevArea, unitsArea, child, blockParamsMap.get(child.id), additionalInfo);
    const childBlockParams = blockParamsMap.get(child.id);
    if (shift[1]) {
      y = shift[1];
    } else {
      y = childBlockParams.bottom.y + IND_HEIGHT + V_SPACE_BETWEEN_BLOCKS;
    }
  });

  if ((!parent.additionalInfo || parent.additionalInfo === GOVERNANCE) && childrenCount) {
    const leftChildBlock = blockParamsMap.get(units[0].id);
    unitsArea.x = leftChildBlock.x;
    unitsArea.y = leftChildBlock.y;
    unitsArea.width = leftChildBlock.width;
    unitsArea.height = y - (prevArea.y + prevArea.height) + AREA_SHIFT;
  }

  return [0, y];
};

/**
 * Отрисовка соединительных линий
 * @param {Map} linesMap
 * @param {Map} blockParamsMap
 * @param {Map} orgUnitAreasMap
 * @param {Map} assignedStaffAreasMap
 * @param {Object} parent
 * @param {Object} [wholeStruct]
 */
const drawConnectors = (linesMap, blockParamsMap, orgUnitAreasMap, assignedStaffAreasMap, parent, wholeStruct) => {
  const parentBlockParams = blockParamsMap.get(parent.id);
  let fromSide;
  let toSide;

  if (parent.otype === POSITION) {
    fromSide = BOTTOM;
    toSide = TOP;
  } else {
    fromSide = LEFT;
    toSide = LEFT;
  }
  if (parent.level === BLOCK_LEVELS.dependent) {
    parentBlockParams.left.y += 10;
  }
  const orgUnitArea = orgUnitAreasMap.get(parent.id);
  const assignedStaffArea = assignedStaffAreasMap.get(parent.id);
  if (!parent.children && (!parent.curation || parent.curation.length === 0)) {
    return;
  }
  const orgUnits = parent.children.filter((child) => child.otype === ORG_UNIT && child.additionalInfo === GOVERNANCE);
  orgUnits.forEach((orgUnit, i) => {
    const orgUnitBlockParams = blockParamsMap.get(orgUnit.id);
    let tempOrgUnit;
    if (parent.otype === POSITION && orgUnits.length > 1 && i > 2 && orgUnitBlockParams.y !== orgUnitArea.y) {
      tempOrgUnit = {...orgUnitArea};
    }
    createUpsideDownConnector(root, linesMap, tempOrgUnit, parentBlockParams, orgUnitBlockParams, fromSide, toSide);
    drawConnectors(linesMap, blockParamsMap, orgUnitAreasMap, assignedStaffAreasMap, orgUnit);
  });

  // отрисовка линий к заместителям
  const positions = parent.children.filter((child) => child.otype === POSITION);
  positions.forEach((child) => {
    const childBlockParams = blockParamsMap.get(child.id);
    createUpsideDownConnector(root, linesMap, undefined, parentBlockParams, childBlockParams, RIGHT, LEFT);
    if (child.curation && child.curation.length > 0) {
      child.curation.forEach((curatedId) => {
        const curatedBlockParams = blockParamsMap.get(curatedId);
        if (curatedBlockParams) {
          createUpsideDownConnector(root, linesMap, undefined, childBlockParams, curatedBlockParams, BOTTOM, TOP, true);
        }
      });
    }
  });

  // отрисовка линий к приписному штату
  const assignedStaff = parent.children.filter((child) => child.additionalInfo === ASSIGNED_STAFF);
  let tempOrgUnit;
  if (parent.otype === POSITION && orgUnitArea) {
    tempOrgUnit = {...orgUnitArea};
  }
  assignedStaff.forEach((assignedStaff) => {
    const assignedStaffBlockParams = blockParamsMap.get(assignedStaff.id);
    createUpsideDownConnector(root, linesMap, tempOrgUnit, parentBlockParams, assignedStaffBlockParams, fromSide, toSide);
    drawConnectors(linesMap, blockParamsMap, orgUnitAreasMap, assignedStaffAreasMap, assignedStaff);
  });

  // отрисовка линий к структурным подразделениям
  const structuralUnits = parent.children.filter((child) => child.additionalInfo === STRUCTURAL_UNIT);
  if (parent.otype === POSITION) {
    if (assignedStaffArea && assignedStaffArea.width && (!orgUnitArea || !orgUnitArea.width)) {
      tempOrgUnit = {...assignedStaffArea};
    } else if (orgUnitArea) {
      tempOrgUnit = {...orgUnitArea};
    }
  }
  structuralUnits.forEach((structuralUnit) => {
    const structuralUnitParams = blockParamsMap.get(structuralUnit.id);
    createUpsideDownConnector(root, linesMap, tempOrgUnit, parentBlockParams, structuralUnitParams, fromSide, toSide);
    drawConnectors(linesMap, blockParamsMap, orgUnitAreasMap, assignedStaffAreasMap, structuralUnits);
  });

  // отрисовка линий координации (пока доступно только для должностей и орг. единиц (не прип. штат и не СП))
  if (parent.otype === POSITION && parent.curation && parent.curation.length > 0) {
    // const curatedBlocks = getCuratedBlocks(wholeStruct, parent.curation, blockParamsMap);
    parent.curation.forEach((curatedId) => {
      const curatedBlockParams = blockParamsMap.get(curatedId);
      if (curatedBlockParams) {
        createUpsideDownConnector(root, linesMap, orgUnitArea, parentBlockParams, curatedBlockParams, BOTTOM, TOP, true);
      }
    });
  }
};

/**
 * Сдвиг всех дочерних блоков вниз
 * @param {Object} parent
 * @param {Map} blocksMap
 * @param {Map} blockParamsMap
 * @param {number} shift
 */
const shiftOrgUnitsDown = (parent, blocksMap, blockParamsMap, shift) => {
  const orgUnits = parent.children.filter((child) => child.otype === ORG_UNIT && child.additionalInfo === GOVERNANCE);

  orgUnits.forEach((child) => {
    const childBlock = blocksMap.get(child.id);
    const childBlockParams = blockParamsMap.get(child.id);
    childBlock.style.top = `${childBlockParams.top.y + shift}px`;
    blockParamsMap.set(child.id, getBlockParams(childBlock, child, childBlockParams.top.y + shift));
    shiftOrgUnitsDown(child, blocksMap, blockParamsMap, shift);
  });
};

/**
 *
 * @param {Map} blocksMap
 * @param {Map} blockParamsMap
 * @param {string} additionalInfo
 * @param {number} verticalShift
 */
const shiftOtherUnitsDown = (blocksMap, blockParamsMap, additionalInfo, verticalShift) => {
  blockParamsMap.forEach((blockParams, key) => {
    if (blockParams.additionalInfo === additionalInfo && blockParams.isRootChild === false) {
      const block = blocksMap.get(key);
      const top = parseInt(block.style.top);
      let additionalShift = 0;
      if (blockParams.nearParentTop) {
        additionalShift = Math.abs(top - blockParams.nearParentTop);
      }
      block.style.top = `${verticalShift + additionalShift}px`;
      blockParamsMap.set(key, getBlockParams(block, {additionalInfo: additionalInfo}, verticalShift + blockParams.nearParentTop));
    }
  });
};

/**
 * Разделитель для зон блоков
 * @param {Map} areaMap
 * @param {number} fullWidth
 */
const drawAreaSeparator = (areaMap, fullWidth) => {
  if (areaMap.size > 0) {
    let areaTop;
    const shift = AREA_SHIFT + 20;
    areaMap.forEach((area) => {
      if (!areaTop) {
        areaTop = area.y;
      }
    });
    if (areaTop) {
      createLine(root, {x: 0, y: areaTop - shift}, {x: fullWidth, y: areaTop - shift}, 'h', 'dashed');
    }
  }
};

const saveBlockParamsMapToDOM = () => {

};

/**
 * Перевод HTML на канву
 * @param {HTMLElement} root
 * @param {string} ofmTitle
 * @param {number} width
 * @param {number} height
 * @param {Map} blocksMap
 * @param {Map} blockParamsMap
 * @param {Map} linesMap
 */
const translateHTMLToCanvasToImage = (root, ofmTitle, width, height, blocksMap, blockParamsMap, linesMap) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  root.appendChild(canvas);
  canvas.setAttribute('visibility', 'hidden');

  const ctx = canvas.getContext('2d');
  if (blockParamsMap) {
    blockParamsMap.forEach((blockParams) => {
      const {x, y, width, height, innerPaddingLeft, innerPaddingRight, borderWidth, borderStyle, backgroundColor, title, functions, indicators} = blockParams;
      canvasDrawRect(ctx, x, y, width, height, innerPaddingLeft, innerPaddingRight, borderWidth, borderStyle, backgroundColor, title, functions, indicators);
    });
  }

  if (linesMap) {
    linesMap.forEach((line) => {
      const nodesLength = line.length;
      line.forEach((node, i) => {
        if (i !== nodesLength - 1) {
          canvasDrawLine(ctx, node, line[i+1]);
        }
      });
    });
  }

  canvas.toBlob((blob) => {
    FileSaver.saveAs(blob, `${ofmTitle}.png`);
  });
};

/**
 * Вывод блока на канву
 * @param {Object} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} innerPaddingLeft
 * @param {number} innerPaddingRight
 * @param {number} borderWidth
 * @param {number} borderStyle
 * @param {string} backgroundColor
 * @param {Object} title
 * @param {Object[]} functions
 * @param {Object[]} indicators
 */
const canvasDrawRect = (ctx, x, y, width, height, innerPaddingLeft, innerPaddingRight, borderWidth, borderStyle, backgroundColor, title, functions, indicators) => {
  ctx.beginPath();
  let spaceBetweenLines = 0;
  let indVShift = 0;
  width += innerPaddingLeft + innerPaddingRight + 1;
  height += 2;
  const rectShift = 0.5;

  switch (borderStyle) {
    case 'solid':
      ctx.lineWidth = borderWidth;
      break;
    case 'double':
      ctx.lineWidth = '1';
      const parsedBorderWidth = borderWidth;
      if (parsedBorderWidth === BORDER_WIDTH.first) {
        spaceBetweenLines = BORDER_WIDTH.first;
      } else if (parsedBorderWidth === BORDER_WIDTH.second) {
        spaceBetweenLines = BORDER_WIDTH.second;
      }
      indVShift += 1;
      break;
    default:
      ctx.lineWidth = '1';
  }
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(x, y, width + spaceBetweenLines, height + spaceBetweenLines);
  ctx.fillStyle = 'black';
  ctx.strokeRect(x + rectShift, y + rectShift, width + spaceBetweenLines, height + spaceBetweenLines);
  if (spaceBetweenLines) {
    ctx.strokeRect(x + spaceBetweenLines + rectShift, y + spaceBetweenLines + rectShift, width - spaceBetweenLines, height - spaceBetweenLines);
  }

  // заголовок
  let textY = y + borderWidth + title.paddingTop;
  const textX = x + innerPaddingLeft + borderWidth;
  const textWidth = width - innerPaddingLeft - innerPaddingRight;
  textY = rectDrawText(ctx, textX, textY, textWidth, innerPaddingLeft, innerPaddingRight, 0, title);

  // Функции
  if (functions.length > 1) {
    functions.forEach((func) => {
      textY = rectDrawText(ctx, textX, textY, textWidth, innerPaddingLeft, innerPaddingRight, 4, func);
    });
  }

  // индикаторы
  if (indicators. length > 1) {
    let indicatorX = x + 1;
    const indicatorY = y + height + borderWidth + indVShift;
    ctx.lineWidth = '1';
    let prevIndX = 0;
    indicators.reverse().forEach((ind) => {
      indicatorX += ind.x - prevIndX;
      prevIndX = ind.x;
      ctx.fillStyle = 'lightyellow';
      ctx.strokeRect(indicatorX, indicatorY, ind.width, ind.height);
      ctx.fillRect(indicatorX, indicatorY, ind.width, ind.height);

      ctx.fillStyle = 'blue';
      ctx.textAlign = 'center';
      ctx.font = ind.font;
      ctx.fillText(ind.text, indicatorX + ind.width / 2, indicatorY + ind.height / 2);
    });
  }
};

const rectDrawText = (ctx, blockX, blockY, width, paddingLeft, paddingRight, lineSpacing, textObject) => {
  const words = textObject.text.split(' ');
  const maxWidth = width;
  const textX = blockX + Math.trunc(maxWidth / 2);
  let line = '';
  let textY = blockY + Math.trunc(textObject.paddingTop * 2 + textObject.height / 2);

  ctx.fillStyle = 'black';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = textObject.font;
  words.forEach((word) => {
    const tmpLine = line + word + ' ';
    const tmpWidth = ctx.measureText(tmpLine).width;
    if (tmpWidth < maxWidth) {
      line = tmpLine;
    } else {
      ctx.fillText(line, textX, textY);
      line = word + ' ';
      textY += textObject.height + lineSpacing;
    }
  });
  if (line) {
    ctx.fillText(line, textX, textY);
    textY += textObject.height + textObject.paddingBottom;
  }
  return textY;
};

const canvasDrawLine = (ctx, pointFrom, pointTo) => {
  ctx.beginPath();
  ctx.moveTo(pointFrom.x + 0.5, pointFrom.y + 0.5);
  ctx.lineTo(pointTo.x + 0.5, pointTo.y + 0.5);
  ctx.fillStyle = 'black';
  ctx.lineWidth = 1;
  ctx.stroke();
};

/**
 * Отрисовка штампа в правом верхнем углу
 * @param {Object} stamp
 * @param {number} fullWidth
 * @return {HTMLElement}
 */
const drawStamp = (stamp, fullWidth) => {
  const width = 500;
  const y = 20;
  const x = fullWidth - width - 10;

  let propArr = stamp.name.split('/');
  const name = `${propArr[0]} ${propArr[1]}`;

  const properties = [];
  propArr = stamp.staff_hc.split('/');
  let prop = {name: propArr[0], value: propArr[1]};
  properties.push(prop);

  propArr = stamp.np.split('/');
  prop = {name: propArr[0], value: propArr[1]};
  properties.push(prop);

  propArr = stamp.nrp_all.split('/');
  prop = {name: propArr[0], value: propArr[1]};
  properties.push(prop);

  propArr = stamp.nup_min.split('/');
  prop = {name: propArr[0], value: propArr[1]};
  properties.push(prop);

  propArr = stamp.kzv_max.split('/');
  prop = {name: propArr[0], value: propArr[1]};
  properties.push(prop);

  return createStampBlock(x, y, width, name, properties);
};

drawScheme();

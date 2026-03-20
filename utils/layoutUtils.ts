/**
 * 计算优化的圆圈布局
 * 根据相册数量动态调整布局方式和参数
 */

export interface LayoutPosition {
  x: number;
  y: number;
  scale: number; // 用于缩放圆圈大小
}

export interface LayoutConfig {
  centerX: number;
  centerY: number;
  radius: number;
  layoutType: 'circle' | 'row' | 'grid';
}

/**
 * 计算单个相册的位置
 */
export function calculateAlbumPosition(
  index: number,
  total: number,
  config: LayoutConfig
): LayoutPosition {
  const { centerX, centerY, radius, layoutType } = config;

  if (layoutType === 'row' && total <= 3) {
    // 行排列：适合相册少的情况
    const spacing = 100;
    const totalWidth = (total - 1) * spacing;
    const startX = centerX - totalWidth / 2;
    return {
      x: startX + index * spacing,
      y: centerY,
      scale: 1,
    };
  } else if (layoutType === 'grid' && total > 3 && total <= 6) {
    // 网格排列：适合相册中等数量的情况
    const cols = Math.ceil(Math.sqrt(total));
    const spacing = 110;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const totalWidth = (cols - 1) * spacing;
    const totalHeight = (Math.ceil(total / cols) - 1) * spacing;
    const startX = centerX - totalWidth / 2;
    const startY = centerY - totalHeight / 2;
    return {
      x: startX + col * spacing,
      y: startY + row * spacing,
      scale: 0.9,
    };
  } else {
    // 圆圈排列：适合相册多的情况
    // 动态调整半径，避免重叠
    let dynamicRadius = radius;
    if (total > 8) {
      dynamicRadius = radius * (1 + (total - 8) * 0.15);
    }

    const angle = (index * 360) / total;
    const radian = (angle * Math.PI) / 180;
    const x = centerX + dynamicRadius * Math.cos(radian);
    const y = centerY + dynamicRadius * Math.sin(radian);

    // 根据相册数量调整圆圈大小
    let scale = 1;
    if (total > 12) {
      scale = 0.7;
    } else if (total > 8) {
      scale = 0.85;
    }

    return {
      x,
      y,
      scale,
    };
  }
}

/**
 * 获取最优的布局配置
 */
export function getOptimalLayoutConfig(
  total: number,
  containerWidth: number,
  containerHeight: number
): LayoutConfig {
  const centerX = containerWidth / 2;
  const centerY = containerHeight / 2;

  let layoutType: 'circle' | 'row' | 'grid';
  let radius = 80;

  if (total <= 3) {
    layoutType = 'row';
  } else if (total <= 6) {
    layoutType = 'grid';
    radius = 60;
  } else {
    layoutType = 'circle';
    radius = Math.min(80, containerWidth / 4, containerHeight / 4);
  }

  return {
    centerX,
    centerY,
    radius,
    layoutType,
  };
}

/**
 * 检查点是否在圆圈内
 */
export function isPointInCircle(
  pointX: number,
  pointY: number,
  circleX: number,
  circleY: number,
  radius: number
): boolean {
  const distance = Math.sqrt(
    Math.pow(pointX - circleX, 2) + Math.pow(pointY - circleY, 2)
  );
  return distance <= radius;
}

/**
 * 获取距离点最近的相册索引
 */
export function getNearestAlbumIndex(
  pointX: number,
  pointY: number,
  positions: LayoutPosition[],
  circleRadius: number
): number | null {
  let minDistance = Infinity;
  let nearestIndex = null;

  positions.forEach((pos, index) => {
    const distance = Math.sqrt(
      Math.pow(pointX - pos.x, 2) + Math.pow(pointY - pos.y, 2)
    );
    if (distance < minDistance && distance <= circleRadius * 1.5) {
      minDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

import {
  closestCenter,
  KeyboardCode,
  MeasuringStrategy,
  pointerWithin,
  type ClientRect,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";

/*
 * 作战板的投放几何：命中判定、量取时机、键盘走位。
 *
 * 单独成文件而不是留在板子里，是因为传感器建在页面上、板子是懒加载的：写在板子里的话，
 * 页面为了拿这一个函数会把整块板子拽进首屏包。这里只有纯函数，没有组件。
 */

/* 投放目标只有列和回收区，行不是目标。指针在画面上时就按指针判，键盘拖拽没有指针，退到按中心判。 */
export const guildWarCollisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

/*
 * 每次移动都重新量投放矩形。默认只在拖起那一刻量一次，而队伍区是个滚动容器：
 * 拖着人滚过去之后，各列的矩形还停在开拖时的位置，指针明明压在队伍上却判不中。
 * 投放目标只有「列数 + 1」个，逐帧量得起。
 */
export const guildWarMeasuring = {
  droppable: { strategy: MeasuringStrategy.Always },
};

const KEYBOARD_STEPS: Record<string, (from: ClientRect, to: ClientRect) => boolean> = {
  [KeyboardCode.Right]: (from, to) => from.left < to.left,
  [KeyboardCode.Left]: (from, to) => from.left > to.left,
  [KeyboardCode.Down]: (from, to) => from.top < to.top,
  [KeyboardCode.Up]: (from, to) => from.top > to.top,
};

function centerDistance(a: ClientRect, b: ClientRect): number {
  return Math.hypot(
    a.left + a.width / 2 - (b.left + b.width / 2),
    a.top + a.height / 2 - (b.top + b.height / 2),
  );
}

/*
 * 键盘拖拽在投放目标之间走：一次一列，外加池子底下的回收区。
 *
 * 不用 @dnd-kit/sortable 那个坐标函数。它服务的是一维排序列表，要求被拖的项本身也是
 * 投放目标；这块板子的投放单位是列，行只是拖拽源，拿它来算会一步都走不动。
 */
export const guildWarKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context: { collisionRect, droppableRects, droppableContainers } },
) => {
  const isAhead = KEYBOARD_STEPS[event.code];
  if (!isAhead || !collisionRect) return;
  event.preventDefault();

  let target: ClientRect | undefined;
  for (const container of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(container.id);
    if (!rect || !isAhead(collisionRect, rect)) continue;
    if (!target || centerDistance(collisionRect, rect) < centerDistance(collisionRect, target)) {
      target = rect;
    }
  }
  if (!target) return;

  // 对中而不是对齐左上角：落点判定按中心算，卡片停在列中间才不会被隔壁那列抢走。
  return {
    x: target.left + (target.width - collisionRect.width) / 2,
    y: target.top + (target.height - collisionRect.height) / 2,
  };
};

import { test, expect } from "@playwright/test";
test("overlay follows main state without its own socket and projects time if updates stop", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("status").first()).toHaveText("已连接");
  await page.getByLabel("称呼", { exact: true }).fill("overlay-host");
  await page.getByRole("button", { name: "创建房间 / 单人" }).click();
  await page.getByLabel("我的主区域", { exact: true }).selectOption("dog");
  await page.getByRole("button", { name: "开始战斗", exact: true }).click();
  await page.getByRole("button", { name: "展开控制", exact: true }).click();
  await page.getByRole("button", { name: "设置剩余", exact: true }).click();
  const overlay = await context.newPage();
  const sockets: string[] = [];
  overlay.on("websocket", (socket) => sockets.push(socket.url()));
  await overlay.setViewportSize({ width: 340, height: 410 });
  await overlay.goto("/?overlay=1");
  await expect(overlay.locator(".overlay-timer")).toHaveCount(1);
  await expect(
    overlay.getByRole("heading", { name: "狗小游戏", exact: true }),
  ).toBeVisible();
  await expect(overlay.locator(".overlay-digits")).toHaveText(
    /4[0-9]\.\d|50\.0/,
  );
  expect(await overlay.locator("button").count()).toBe(0);
  await overlay.screenshot({
    path: "test-results/overlay-dog.png",
    omitBackground: true,
  });
  await page.getByLabel("我的主区域", { exact: true }).selectOption("bird");
  await expect(overlay.locator(".overlay-timer")).toHaveCount(2);
  await expect(
    overlay.getByRole("heading", { name: "狗小游戏", exact: true }),
  ).toHaveCount(0);
  await expect(
    overlay.getByText("语音：飞行校准", { exact: true }),
  ).toBeVisible();
  await overlay.screenshot({
    path: "test-results/overlay-bird.png",
    omitBackground: true,
  });
  await page.getByRole("button", { name: "进入二阶段", exact: true }).click();
  await expect(
    overlay.getByRole("heading", { name: "卡琳小游戏", exact: true }),
  ).toBeVisible();
  await expect(
    overlay.getByRole("heading", { name: "卡琳画卷", exact: true }),
  ).toBeVisible();
  const flight = page.locator("article").filter({
    has: page.getByRole("heading", { name: "卡琳飞行", exact: true }),
  });
  await flight.getByRole("button", { name: "设置剩余", exact: true }).click();
  await page.getByText("本地设置", { exact: true }).click();
  const opacity = page.getByRole("slider", { name: /悬浮窗背景不透明度/ });
  await opacity.focus();
  await opacity.press("Home");
  await expect(overlay.locator(".overlay-shell")).toHaveCSS(
    "background-color",
    "rgba(12, 20, 30, 0.15)",
  );
  expect(sockets.filter((url) => url.includes("/socket.io/"))).toEqual([]);
  const digits = overlay
    .locator(".overlay-timer")
    .filter({
      has: overlay.getByRole("heading", { name: "卡琳飞行", exact: true }),
    })
    .locator(".overlay-digits");
  const before = Number(await digits.innerText());
  await page.close();
  await expect(overlay.getByText("离线投影", { exact: true })).toBeVisible();
  expect(Number(await digits.innerText())).toBeLessThan(before);
});
test("default window fits compact P1 content and shows voice hints for every skill", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 870 });
  await page.goto("/");
  await expect(page.getByRole("status").first()).toHaveText("已连接");
  await page.getByLabel("称呼", { exact: true }).fill("layout-host");
  await page.getByRole("button", { name: "创建房间 / 单人" }).click();
  await page.getByRole("button", { name: "开始战斗", exact: true }).click();
  await expect(page.locator(".voice-hint")).toHaveCount(4);
  await expect(page.getByText("语音：飞行校准", { exact: true })).toBeVisible();
  await expect(page.getByText("语音：虎开始", { exact: true })).toBeVisible();
  const bottom = await page
    .locator("footer")
    .evaluate((node) => node.getBoundingClientRect().bottom);
  await page.screenshot({ path: "test-results/default-window.png" });
  expect(bottom).toBeLessThanOrEqual(870);
  await page.setViewportSize({ width: 360, height: 640 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});
test("host and member share calibrated timers, assignments and phase lifecycle", async ({
  browser,
}) => {
  const hostContext = await browser.newContext(),
    memberContext = await browser.newContext();
  const host = await hostContext.newPage(),
    member = await memberContext.newPage();
  const errors: string[] = [];
  host.on("pageerror", (e) => errors.push(e.message));
  member.on("pageerror", (e) => errors.push(e.message));
  try {
    await host.goto("/");
    await expect(host.getByRole("status").first()).toHaveText("已连接");
    await host.getByLabel("称呼", { exact: true }).fill("房主");
    await host.getByRole("button", { name: "创建房间 / 单人" }).click();
    const heading = host.getByRole("heading", { name: /房间 [A-Z2-9]{6}/ });
    await expect(heading).toBeVisible();
    const code = (await heading.innerText()).split(" ")[1];
    await member.goto(`/?room=${code}`);
    await expect(member.getByRole("status").first()).toHaveText("已连接");
    await member.getByLabel("称呼", { exact: true }).fill("队员");
    await member.getByRole("button", { name: "加入房间", exact: true }).click();
    await expect(
      member.getByRole("heading", { name: `房间 ${code}` }),
    ).toBeVisible();
    await expect(
      member.getByRole("button", { name: "开始战斗", exact: true }),
    ).toHaveCount(0);
    await host.getByLabel("我的主区域", { exact: true }).selectOption("bird");
    await expect(
      member.getByText("房主 ♛ · 鸟", { exact: true }),
    ).toBeVisible();
    await member.getByLabel("我的主区域", { exact: true }).selectOption("dog");
    await expect(
      member.getByRole("button", { name: "语音识别", exact: true }),
    ).toBeDisabled();
    await host.getByRole("button", { name: "开始战斗", exact: true }).click();
    await host.getByRole("button", { name: "展开控制", exact: true }).click();
    const dog = host.locator("article").filter({
      has: host.getByRole("heading", { name: "狗小游戏", exact: true }),
    });
    await expect(
      dog.getByText("首轮延迟未配置 · 需要本区成员校准"),
    ).toBeVisible();
    await expect(
      dog.getByRole("button", { name: "设置剩余", exact: true }),
    ).toHaveCount(0);
    await member.getByRole("button", { name: "展开控制", exact: true }).click();
    await expect(
      member.getByRole("button", { name: "鸟区域校准", exact: true }),
    ).toHaveCount(0);
    await expect(
      member.getByRole("button", { name: "狗区域校准", exact: true }),
    ).toBeVisible();
    await expect(
      member.getByText("P1 额外区域订阅", { exact: false }),
    ).toHaveCount(0);
    const memberDog = member.locator("article").filter({
      has: member.getByRole("heading", { name: "狗小游戏", exact: true }),
    });
    await memberDog
      .getByRole("button", { name: "设置剩余", exact: true })
      .click();
    await expect(dog.locator(".digits")).toHaveText(/4[89]\.\d|50\.0/);
    await expect(memberDog.locator(".digits")).toHaveText(/4[89]\.\d|50\.0/);
    await expect(memberDog.getByText("预测激活 · 未确认施法")).toBeVisible();
    await memberDog.getByRole("button", { name: "撤销上次修改" }).click();
    await expect(memberDog.locator(".digits")).toHaveText("—");
    await host.getByLabel("我的主区域", { exact: true }).selectOption("tiger");
    await host.getByRole("button", { name: "开始 30 秒单次" }).click();
    await expect(member.getByText("手动倒计时", { exact: true })).toBeVisible();
    await host.getByRole("button", { name: "进入二阶段", exact: true }).click();
    await expect(
      member.getByRole("heading", { name: "卡琳小游戏", exact: true }),
    ).toBeVisible();
    await host.getByRole("button", { name: "进入三阶段", exact: true }).click();
    await expect(member.getByText("等待“三凶兽死亡”事件")).toBeVisible();
    await host.getByRole("button", { name: "三凶兽死亡", exact: true }).click();
    await expect(
      member.getByText(
        "以三凶兽死亡作校准参考，下一次 = 参考 + 冷却；首轮延迟仍未知。",
      ),
    ).toBeVisible();
    await host.getByRole("button", { name: "重置战斗", exact: true }).click();
    await expect(member.getByText(/大厅 · 普通/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await hostContext.close();
    await memberContext.close();
  }
});

test("offline clients keep projected deadlines and reconcile without allowing offline commands", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const routes: import("@playwright/test").WebSocketRoute[] = [];
  await context.routeWebSocket("**/socket.io/**", (route) => {
    routes.push(route);
    route.connectToServer();
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("status").first()).toHaveText("已连接");
    await page.getByLabel("称呼", { exact: true }).fill("offline-host");
    await page.getByRole("button", { name: "创建房间 / 单人" }).click();
    await expect(
      page.getByRole("heading", { name: /房间 [A-Z2-9]{6}/ }),
    ).toBeVisible();
    await page.getByLabel("我的主区域", { exact: true }).selectOption("dog");
    await page.getByRole("button", { name: "开始战斗", exact: true }).click();
    await page.getByRole("button", { name: "展开控制", exact: true }).click();
    const dog = page.locator("article").filter({
      has: page.getByRole("heading", { name: "狗小游戏", exact: true }),
    });
    await dog.getByRole("button", { name: "设置剩余", exact: true }).click();
    await expect(dog.locator(".digits")).toHaveText(/4[89]\.\d|50\.0/);
    await context.setOffline(true);
    for (const route of routes)
      await route.close({ code: 1001, reason: "test offline" });
    await expect(
      page.getByText(
        "离线：仅显示本地投影，修改不可用；连接恢复后自动获取完整快照。",
      ),
    ).toBeVisible();
    await expect(
      dog.getByRole("button", { name: "设置剩余", exact: true }),
    ).toBeDisabled();
    const before = Number(await dog.locator(".digits").innerText());
    await expect
      .poll(async () => Number(await dog.locator(".digits").innerText()))
      .toBeLessThan(before);
    await context.setOffline(false);
    await expect(page.getByRole("status").first()).toHaveText("已连接");
    await expect(
      dog.getByRole("button", { name: "设置剩余", exact: true }),
    ).toBeEnabled();
    await expect(dog.getByText("预测激活 · 未确认施法")).toBeVisible();
  } finally {
    await context.close();
  }
});

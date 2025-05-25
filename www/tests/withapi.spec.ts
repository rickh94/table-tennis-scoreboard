import { test, expect } from "@playwright/test";
import {
  execSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "child_process";
import path from "path";
import { advanceGame, increaseSideScore, setSideScore } from "./util";

const MOCK_SBID1 = "123123";

// TODO: test ui elements and mode switching
//
let server: ChildProcessWithoutNullStreams | undefined;

test.describe("api", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("calls init with name", async ({ page }) => {
    const name = "testname";
    await page.getByTestId("menu-button").click();
    await page.getByTestId("remote-button").click();
    await page.getByTestId("setup-scoreboard-button").click();
    await page.getByTestId("scoreboard-name").fill(name);
    await page.getByTestId("scoreboard-submit-button").click();
    await expect(page.getByTestId("scoreboard-ready")).toBeVisible();
  });

  test("has name on scoreboard", async ({ page }) => {
    const name = "testname";
    await page.getByTestId("menu-button").click();
    await page.getByTestId("remote-button").click();
    await page.getByTestId("setup-scoreboard-button").click();
    await page.getByTestId("scoreboard-name").fill(name);
    await page.getByTestId("scoreboard-submit-button").click();
    await expect(page.getByTestId("scoreboard-ready")).toBeVisible();
    await page.getByTestId("setup-done-button").click();
    // back on the main page
    await expect(page.getByTestId("left-score")).toBeVisible();
    await expect(page.getByTestId("scoreboard-title")).toBeVisible();
    await expect(page.getByTestId("scoreboard-title")).toContainText(
      "testname",
    );
  });

  test("displays code", async ({ page }) => {
    const name = "testname";
    await page.getByTestId("menu-button").click();
    await page.getByTestId("remote-button").click();
    await page.getByTestId("setup-scoreboard-button").click();
    await page.getByTestId("scoreboard-name").fill(name);
    await page.getByTestId("scoreboard-submit-button").click();
    await expect(page.getByTestId("scoreboard-ready")).toBeVisible();
    await expect(page.getByTestId("manual-endpoint")).toBeVisible();
    await expect(page.getByTestId("manual-endpoint")).toContainText("http");
    await expect(page.getByTestId("manual-code")).toBeVisible();
    expect(await page.getByTestId("manual-code").textContent()).toMatch(
      /^\d{6}$/,
    );
    await expect(page.getByTestId("qrcode")).toBeVisible();
  });

  test("can connect as remote", async ({ page, context }) => {
    const name = "testname";
    await page.getByTestId("menu-button").click();
    await page.getByTestId("remote-button").click();
    await page.getByTestId("setup-scoreboard-button").click();
    await page.getByTestId("scoreboard-name").fill(name);
    await page.getByTestId("scoreboard-submit-button").click();
    const code = await page.getByTestId("manual-code").textContent();
    if (!code) {
      expect(false);
      return;
    }
    const secondPage = await context.newPage();
    secondPage.goto("/");
    await secondPage.getByTestId("menu-button").click();
    await secondPage.getByTestId("remote-button").click();
    await secondPage.getByTestId("setup-remote-button").click();
    await secondPage.getByTestId("scoreboard-code").fill(code);
    await secondPage.getByTestId("remote-submit-button").click();
    await expect(secondPage.getByTestId("left-score")).toBeVisible();
    await expect(secondPage.getByTestId("scoreboard-title")).toBeVisible();
    await expect(secondPage.getByTestId("scoreboard-title")).toContainText(
      name,
    );
  });

  test("remote reflects different starting state", async ({
    page,
    context,
  }) => {
    const name = "testname";
    await page.getByTestId("left-button").click();
    await page.getByTestId("left-button").click();
    // player 1 score is 2 (will be on left)
    await page.getByTestId("menu-button").click();
    await page.getByTestId("remote-button").click();
    await page.getByTestId("setup-scoreboard-button").click();
    await page.getByTestId("scoreboard-name").fill(name);
    await page.getByTestId("scoreboard-submit-button").click();
    const code = await page.getByTestId("manual-code").textContent();
    if (!code) {
      expect(false);
      return;
    }
    const secondPage = await context.newPage();
    secondPage.goto("/");
    await secondPage.getByTestId("menu-button").click();
    await secondPage.getByTestId("remote-button").click();
    await secondPage.getByTestId("setup-remote-button").click();
    await secondPage.getByTestId("scoreboard-code").fill(code);
    await secondPage.getByTestId("remote-submit-button").click();
    await expect(secondPage.getByTestId("left-score")).toBeVisible();
    await expect(secondPage.getByTestId("left-score")).toContainText("2");
  });

  test("remote controls scoreboard state", async ({ page, context }) => {
    const name = "testname";
    await page.getByTestId("menu-button").click();
    await page.getByTestId("remote-button").click();
    await page.getByTestId("setup-scoreboard-button").click();
    await page.getByTestId("scoreboard-name").fill(name);
    await page.getByTestId("scoreboard-submit-button").click();
    const code = await page.getByTestId("manual-code").textContent();
    if (!code) {
      expect(false);
      return;
    }
    await page.getByTestId("setup-done-button").click();
    const secondPage = await context.newPage();
    secondPage.goto("/");
    await secondPage.getByTestId("menu-button").click();
    await secondPage.getByTestId("remote-button").click();
    await secondPage.getByTestId("setup-remote-button").click();
    await secondPage.getByTestId("scoreboard-code").fill(code);
    await secondPage.getByTestId("remote-submit-button").click();
    await expect(page.getByTestId("left-score")).toContainText("0");
    await secondPage.getByTestId("left-button").click();
    await expect(secondPage.getByTestId("left-score")).toContainText("1");
    await expect(page.getByTestId("left-score")).toContainText("1");
  });

  test("/remote presents code form", async ({ page }) => {
    await page.goto("/remote");
    await expect(page.getByTestId("scoreboard-code")).toBeVisible();
    await expect(page.getByTestId("remote-connect-title")).toBeVisible();
  });

  test("autoconnect endpoint works", async ({ page, context }) => {
    const name = "testname";
    await page.getByTestId("right-button").click();
    await expect(page.getByTestId("right-score")).toContainText("1");
    await page.getByTestId("menu-button").click();
    await page.getByTestId("remote-button").click();
    await page.getByTestId("setup-scoreboard-button").click();
    await page.getByTestId("scoreboard-name").fill(name);
    await page.getByTestId("scoreboard-submit-button").click();
    const endpoint = await page
      .getByTestId("autoconnect-endpoint")
      .textContent();
    if (!endpoint) {
      expect(false);
      return;
    }
    await page.getByTestId("setup-done-button").click();
    const secondPage = await context.newPage();
    await secondPage.goto(endpoint);
    await expect(secondPage.getByTestId("left-score")).toBeVisible();
    await expect(secondPage.getByTestId("scoreboard-title")).toBeVisible();
    await expect(secondPage.getByTestId("scoreboard-title")).toContainText(
      name,
    );
    await expect(secondPage.getByTestId("right-score")).toContainText("1");
  });

  test("controls game remotely", async ({ page, context }) => {
    const name = "testname";
    await page.getByTestId("menu-button").click();
    await page.getByTestId("remote-button").click();
    await page.getByTestId("setup-scoreboard-button").click();
    await page.getByTestId("scoreboard-name").fill(name);
    await page.getByTestId("scoreboard-submit-button").click();
    const endpoint = await page
      .getByTestId("autoconnect-endpoint")
      .textContent();
    if (!endpoint) {
      expect(false);
      return;
    }
    await page.getByTestId("setup-done-button").click();
    const secondPage = await context.newPage();
    await secondPage.goto(endpoint);
    for (let i = 0; i < 11; ++i) {
      await secondPage.getByTestId("left-button").click();
    }
    await expect(page.getByTestId("winner-text")).toContainText("Player 1");
    await expect(secondPage.getByTestId("winner-text")).toContainText(
      "Player 1",
    );

    await advanceGame(secondPage);
    await expect(page.getByTestId("right-score")).toBeVisible();
    await expect(secondPage.getByTestId("right-games")).toContainText("1");
    await expect(page.getByTestId("right-games")).toContainText("1");
    await setSideScore(secondPage, "left", 10);
    await setSideScore(secondPage, "right", 9);
    await increaseSideScore(secondPage, "left", 1);

    await expect(page.getByTestId("winner-text")).toContainText("Player 2");
    await expect(secondPage.getByTestId("winner-text")).toContainText(
      "Player 2",
    );
    await advanceGame(secondPage);

    await expect(secondPage.getByTestId("right-games")).toContainText("1");
    await expect(page.getByTestId("right-games")).toContainText("1");

    await expect(secondPage.getByTestId("left-games")).toContainText("1");
    await expect(page.getByTestId("left-games")).toContainText("1");

    await setSideScore(secondPage, "left", 10);
    await setSideScore(secondPage, "right", 9);
    await increaseSideScore(secondPage, "left", 1);

    await expect(page.getByTestId("winner-text")).toContainText("Player 1");
    await expect(secondPage.getByTestId("winner-text")).toContainText(
      "Player 1",
    );
    await advanceGame(secondPage);

    await expect(secondPage.getByTestId("right-games")).toContainText("2");
    await expect(page.getByTestId("right-games")).toContainText("2");

    await expect(secondPage.getByTestId("left-games")).toContainText("1");
    await expect(page.getByTestId("left-games")).toContainText("1");

    await setSideScore(secondPage, "right", 10);
    await setSideScore(secondPage, "left", 9);
    await increaseSideScore(secondPage, "right", 1);

    await expect(page.getByTestId("winner-text")).toContainText("Player 1");
    await expect(page.getByTestId("wins-the-match")).toBeVisible();
    await expect(secondPage.getByTestId("winner-text")).toContainText(
      "Player 1",
    );

    await page.getByTestId("new-match-button").click();

    await expect(secondPage.getByTestId("right-games")).toContainText("0");
    await expect(page.getByTestId("right-games")).toContainText("0");

    await expect(secondPage.getByTestId("left-games")).toContainText("0");
    await expect(page.getByTestId("left-games")).toContainText("0");

    await expect(secondPage.getByTestId("right-score")).toContainText("0");
    await expect(page.getByTestId("right-score")).toContainText("0");

    await expect(secondPage.getByTestId("left-score")).toContainText("0");
    await expect(page.getByTestId("left-score")).toContainText("0");
  });

  test("can make correction", async ({ page, context }) => {
    const name = "testname";
    await page.getByTestId("menu-button").click();
    await page.getByTestId("remote-button").click();
    await page.getByTestId("setup-scoreboard-button").click();
    await page.getByTestId("scoreboard-name").fill(name);
    await page.getByTestId("scoreboard-submit-button").click();
    const endpoint = await page
      .getByTestId("autoconnect-endpoint")
      .textContent();
    if (!endpoint) {
      expect(false);
      return;
    }
    await page.getByTestId("setup-done-button").click();
    const secondPage = await context.newPage();
    await secondPage.goto(endpoint);
    await setSideScore(secondPage, "left", 3);

    await secondPage.getByTestId("correction-button").click();
    await secondPage.getByTestId("left-correction-button").click();
    await secondPage.getByTestId("end-correction-button").click();
    await expect(secondPage.getByTestId("left-score")).toContainText("2");
    await expect(page.getByTestId("left-score")).toContainText("2");
  });
});

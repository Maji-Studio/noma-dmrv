/**
 * Chain of Custody E2E Tests
 *
 * Covers:
 * - Page loads and displays the header with title and facility selector
 * - Facility dropdown is populated with seeded facility
 * - Selecting a facility renders the React Flow DAG visualization
 * - All 12 entity nodes are rendered in the graph
 * - Edges (connections) are rendered between nodes
 * - Nodes with seeded data show non-zero counts
 * - Clickable nodes navigate to their entity list pages
 * - Edge colors are purple
 */
import { test, expect } from "./fixtures";

// ============================================
// Chain of Custody Visualization
// ============================================

test.describe("Chain of Custody Visualization", () => {
  test("page loads with header and facility selector populated", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const page = adminPage;

    await page.goto("/chain-of-custody");
    await expect(page).toHaveURL(/\/chain-of-custody/);

    // Header title is visible
    await expect(page.getByRole("heading", { name: /Chain of Custody/i })).toBeVisible();

    // Facility selector is visible
    const select = page.locator("select");
    await expect(select).toBeVisible({ timeout: 15000 });

    // Wait for facilities to load — the dropdown should eventually contain our seeded facility
    // The React Query hook fetches facilities async, so we need to poll
    await expect(async () => {
      const html = await select.innerHTML();
      expect(html).toContain(seededData.facility.code);
    }).toPass({ timeout: 15000 });
  });

  test("selecting a facility renders the DAG visualization with nodes and edges", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const page = adminPage;

    await page.goto("/chain-of-custody");

    // Wait for facilities to load and select the seeded facility
    const select = page.locator("select");
    await expect(select).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      const html = await select.innerHTML();
      expect(html).toContain(seededData.facility.id);
    }).toPass({ timeout: 15000 });
    await select.selectOption(seededData.facility.id);

    // Wait for React Flow canvas to render
    const viewport = page.locator(".react-flow__viewport");
    await expect(viewport).toBeVisible({ timeout: 15000 });

    // All 12 entity nodes should be rendered
    const expectedLabels = [
      "Reactors",
      "Feedstock Bin",
      "Biochar Bin",
      "Product Bin",
      "Feedstock Deliveries",
      "Feedstocks",
      "Production Runs",
      "Samples",
      "Biochar Products",
      "Orders",
      "Deliveries",
      "Applications",
      "Credit Batches",
    ];

    for (const label of expectedLabels) {
      await expect(
        page.locator(".react-flow__node").filter({ hasText: label }).first()
      ).toBeVisible({ timeout: 10000 });
    }

    // Edges should be rendered (smoothstep paths)
    const edges = page.locator(".react-flow__edge");
    const edgeCount = await edges.count();
    expect(edgeCount).toBeGreaterThanOrEqual(10); // 15 defined edges
  });

  test("nodes display correct counts for seeded data", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const page = adminPage;

    await page.goto("/chain-of-custody");

    // Wait for facilities to load and select the seeded facility
    const select = page.locator("select");
    await expect(select).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      const html = await select.innerHTML();
      expect(html).toContain(seededData.facility.id);
    }).toPass({ timeout: 15000 });
    await select.selectOption(seededData.facility.id);

    // Wait for React Flow to render
    await expect(page.locator(".react-flow__viewport")).toBeVisible({ timeout: 15000 });

    // The seeded data includes: 1 reactor, 2 storage locations,
    // 1 feedstock delivery, 1 feedstock, 1 biochar product
    // Verify that the Reactors node shows a count of at least 1
    const reactorsNode = page.locator('[data-testid="rf__node-reactors"]');
    await expect(reactorsNode).toBeVisible({ timeout: 10000 });
    // Use the heading element for the count (title-heading-3 class)
    await expect(reactorsNode.locator(".title-heading-3")).toHaveText("1");

    // Feedstocks node should also show at least 1
    const feedstocksNode = page.locator('[data-testid="rf__node-feedstocks"]');
    await expect(feedstocksNode).toBeVisible({ timeout: 10000 });
    await expect(feedstocksNode.locator(".title-heading-3")).toHaveText("1");
  });

  test("clickable nodes navigate to entity list pages", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const page = adminPage;

    await page.goto("/chain-of-custody");

    // Wait for facilities to load and select the seeded facility
    const select = page.locator("select");
    await expect(select).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      const html = await select.innerHTML();
      expect(html).toContain(seededData.facility.id);
    }).toPass({ timeout: 15000 });
    await select.selectOption(seededData.facility.id);

    // Wait for React Flow to render
    await expect(page.locator(".react-flow__viewport")).toBeVisible({ timeout: 15000 });

    // Click the Reactors node — should navigate to /reactors
    const reactorsNode = page.locator('[data-testid="rf__node-reactors"]');
    await expect(reactorsNode).toBeVisible({ timeout: 10000 });

    // React Flow's pane overlay intercepts pointer events — dispatch click via JS
    await reactorsNode.locator("div.group").first().dispatchEvent("click");

    await expect(page).toHaveURL(/\/reactors/, { timeout: 15000 });
  });

  test("edges are rendered with purple color", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const page = adminPage;

    await page.goto("/chain-of-custody");

    const select = page.locator("select");
    await expect(select).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      const html = await select.innerHTML();
      expect(html).toContain(seededData.facility.id);
    }).toPass({ timeout: 15000 });
    await select.selectOption(seededData.facility.id);

    await expect(page.locator(".react-flow__viewport")).toBeVisible({ timeout: 15000 });

    // Check that at least one edge path exists with the purple stroke style
    // SVG paths with no fill can be reported as "hidden" by Playwright,
    // so we check for attachment and attributes instead of visibility
    const edgePath = page.locator(".react-flow__edge path").first();
    await expect(edgePath).toBeAttached({ timeout: 10000 });

    // The stroke should reference the purple CSS variable via marker-end or style
    const markerEnd = await edgePath.getAttribute("marker-end");
    const stroke = await edgePath.getAttribute("style");
    const hasPurple =
      (markerEnd && markerEnd.includes("clr-purple")) ||
      (stroke && stroke.includes("clr-purple"));
    expect(hasPurple).toBeTruthy();
  });

  test("minimap and controls are visible", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const page = adminPage;

    await page.goto("/chain-of-custody");

    const select = page.locator("select");
    await expect(select).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      const html = await select.innerHTML();
      expect(html).toContain(seededData.facility.id);
    }).toPass({ timeout: 15000 });
    await select.selectOption(seededData.facility.id);

    await expect(page.locator(".react-flow__viewport")).toBeVisible({ timeout: 15000 });

    // Controls panel is visible
    await expect(page.locator(".react-flow__controls")).toBeVisible();

    // MiniMap is visible
    await expect(page.locator(".react-flow__minimap")).toBeVisible();
  });
});

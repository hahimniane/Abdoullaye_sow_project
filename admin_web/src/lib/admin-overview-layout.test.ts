import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const overviewSource = readFileSync(
  new URL("../components/admin-console.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("Today restores the viewport and prioritizes operational work before analytics", () => {
  const todayStart = overviewSource.indexOf("function Today(");
  const todayEnd = overviewSource.indexOf("function StatusMeter(", todayStart);
  const todaySource = overviewSource.slice(todayStart, todayEnd);

  assert.match(
    todaySource,
    /window\.scrollTo\(\{\s*top:\s*0,\s*left:\s*0,\s*behavior:\s*"auto"\s*\}\)/,
    "Today must not mount underneath the sticky header at a stale document scroll position",
  );
  assert.match(todaySource, /className="stack today-dashboard"/);

  const operationsIndex = todaySource.indexOf('className="today-layout"');
  const analyticsIndex = todaySource.indexOf('className="chart-grid"');
  assert.ok(operationsIndex >= 0, "Today must render the operations layout");
  assert.ok(
    analyticsIndex > operationsIndex,
    "operational queues must appear before the analytics snapshot",
  );
});

test("Today overview layout stays scoped and collapses predictably", () => {
  assert.match(
    stylesSource,
    /\.today-dashboard \.today-layout\s*\{[^}]*grid-template-areas:\s*"attention attention attention"\s*"health service status"/,
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 720px\)\s*\{[\s\S]*?\.today-dashboard \.today-layout\s*\{[^}]*grid-template-areas:\s*"attention"\s*"health"\s*"service"\s*"status"/,
  );
  assert.match(
    stylesSource,
    /\.today-dashboard \.donut\s*\{[^}]*height:\s*84px;[^}]*width:\s*84px;/,
    "overview charts should stay compact instead of dominating the operations page",
  );
});

import { useState } from "react";
import TemplatesPage from "./pages/TemplatesPage";
import InspectionPage from "./pages/InspectionPage";
import RecordsPage from "./pages/RecordsPage";
import ReviewStation from "./pages/ReviewStation";
import { resetToSeed, useStore } from "./storage/store";

type PageKey = "inspect" | "templates" | "records" | "review";

const NAV: { key: PageKey; label: string }[] = [
  { key: "inspect", label: "巡检填报" },
  { key: "templates", label: "标准版本" },
  { key: "records", label: "巡检记录" },
  { key: "review", label: "异常复核台" }
];

export default function App() {
  const db = useStore();
  const [page, setPage] = useState<PageKey>("inspect");
  const [pendingSpot, setPendingSpot] = useState<{ inspectionId: string; deviceId: string | null } | null>(null);

  const openAnomalyCount = db.anomalies.filter((item) => item.status === "open").length;
  const openReviewCount = db.reviews.filter((item) => item.status === "open").length;
  const abnormalRecordCount = new Set(
    db.records
      .flatMap((record) => record.results.filter((result) => result.verdict === "abnormal").map(() => record.id))
  ).size;

  function gotoSpotCheck(inspectionId: string, deviceId?: string) {
    setPendingSpot({ inspectionId, deviceId: deviceId ?? null });
    setPage("review");
  }

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">石油行业 · 设备巡检标准化闭环</p>
            <h1>油站巡检标准与异常复核台</h1>
            <p className="subtitle">
              管理员按区域发布检查模板（必检设备、允许范围、生效时间）；巡检提交即冻结标准版本，
              抽检偏离自动派发复核任务，异常闭环后才能发布同区域新标准。
            </p>
          </div>
          <div className="top-side">
            <div className="stack">
              {["React", "Vite", "TypeScript", "无新增依赖"].map((item) => (
                <span className="tag" key={item}>{item}</span>
              ))}
            </div>
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                if (window.confirm("清空当前浏览器数据并恢复演示数据？")) {
                  resetToSeed();
                  setPage("inspect");
                }
              }}
            >
              恢复演示数据
            </button>
          </div>
        </header>

        <section className="metrics">
          <article className="metric">
            <span>已发布标准版本</span>
            <strong>{db.templates.filter((tpl) => tpl.status === "published").length}</strong>
          </article>
          <article className="metric">
            <span>巡检记录（快照）</span>
            <strong>{db.records.length}</strong>
          </article>
          <article className="metric">
            <span>含异常记录</span>
            <strong>{abnormalRecordCount}</strong>
          </article>
          <article className="metric">
            <span>未闭环异常 / 待复核</span>
            <strong className={openAnomalyCount ? "metric-alert" : ""}>
              {openAnomalyCount} <em className="metric-slash">/</em> {openReviewCount}
            </strong>
          </article>
        </section>

        <nav className="main-nav">
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={page === item.key ? "nav-item active" : "nav-item"}
              onClick={() => setPage(item.key)}
            >
              {item.label}
              {item.key === "review" && openReviewCount > 0 ? (
                <span className="nav-count">{openReviewCount}</span>
              ) : null}
            </button>
          ))}
        </nav>

        {page === "templates" ? <TemplatesPage /> : null}
        {page === "inspect" ? <InspectionPage /> : null}
        {page === "records" ? <RecordsPage onSpotCheck={gotoSpotCheck} /> : null}
        {page === "review" ? (
          <ReviewStation
            initialTab={pendingSpot ? "spot" : "review"}
            pendingInspectionId={pendingSpot?.inspectionId ?? null}
            pendingDeviceId={pendingSpot?.deviceId ?? null}
            consumePending={() => setPendingSpot(null)}
          />
        ) : null}
      </div>
    </main>
  );
}

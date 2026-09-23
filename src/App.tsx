import { useMemo, useState } from "react";
import { Button, Popconfirm, Tabs } from "antd";
import { useStore } from "./store/useStore";
import InspectPage from "./ui/InspectPage";
import ReviewPage from "./ui/ReviewPage";
import StandardsPage from "./ui/StandardsPage";

const stack = ["React", "Vite", "TypeScript", "Zustand", "Ant Design"];

export default function App() {
  const templates = useStore((state) => state.templates);
  const records = useStore((state) => state.records);
  const tasks = useStore((state) => state.tasks);
  const resetAll = useStore((state) => state.resetAll);
  const [activeKey, setActiveKey] = useState("standards");

  const metrics = useMemo(() => {
    const published = templates.filter((template) => template.status === "published").length;
    const openAbnormal = records
      .flatMap((record) => record.entries)
      .filter((entry) => entry.judgement === "abnormal" && entry.closure.status === "open").length;
    const pending = tasks.filter((task) => task.status === "pending").length;
    return [
      { label: "生效模板", value: published },
      { label: "未闭环异常", value: openAbnormal },
      { label: "待复核任务", value: pending },
    ];
  }, [templates, records, tasks]);

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">石油行业 · 设备巡检标准与复核</p>
            <h1>油站巡检标准版本与异常复核台</h1>
            <p className="subtitle">
              按区域发布检查模板，登记必检设备、允许范围与生效窗口；巡检提交冻结模板版本，抽检偏离生成复核任务，复核人须与原巡检人不同。
            </p>
          </div>
          <div className="header-side">
            <div className="stack">
              {stack.map((item) => (
                <span className="tag" key={item}>
                  {item}
                </span>
              ))}
            </div>
            <Popconfirm
              title="恢复演示数据？"
              description="将清空本地修改并重新载入种子数据。"
              onConfirm={() => {
                resetAll();
              }}
            >
              <Button size="small" type="text">
                恢复演示数据
              </Button>
            </Popconfirm>
          </div>
        </header>

        <section className="metrics">
          {metrics.map((metric) => (
            <article className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </section>

        <section className="content-card">
          <Tabs
            activeKey={activeKey}
            onChange={setActiveKey}
            items={[
              { key: "standards", label: "巡检标准版本", children: <StandardsPage /> },
              { key: "inspect", label: "巡检填报", children: <InspectPage /> },
              { key: "review", label: "异常复核台", children: <ReviewPage /> },
            ]}
          />
        </section>
      </div>
    </main>
  );
}

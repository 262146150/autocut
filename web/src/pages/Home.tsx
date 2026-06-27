// Home.tsx — 工作台总览：分类 Tab + 模块卡片
import { useState } from "react";
import { Link } from "react-router-dom";
import { CATS, type ModuleDef } from "../data/modules";
import { Icon } from "../components/Icons";

function Card({ m }: { m: ModuleDef }) {
  const inner = (
    <>
      <div className="card-top">
        <span className="card-ic"><Icon name={m.icon} size={22} /></span>
        <span className="card-name">{m.name}</span>
        <span className={`badge ${m.ready ? "" : "soon"}`}>{m.ready ? "功能可用" : "敬请期待"}</span>
      </div>
      <div className="card-desc">{m.desc}</div>
      <div className="tags">{m.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
    </>
  );
  return m.ready
    ? <Link className="card" to={`/${m.id}`}>{inner}</Link>
    : <div className="card soon">{inner}</div>;
}

export default function Home() {
  const [cat, setCat] = useState("创作中心");
  return (
    <div className="home">
      <div className="home-head">
        <div>
          <h1>智能视频批量处理工作站</h1>
        </div>
      </div>
      <div className="cats">
        {Object.keys(CATS).map((c) => (
          <button key={c} className={c === cat ? "active" : ""} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div className="grid">
        {CATS[cat].map((m) => <Card key={m.id} m={m} />)}
      </div>
    </div>
  );
}

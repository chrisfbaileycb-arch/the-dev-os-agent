import React from "react";
import { Helmet } from "react-helmet";
import { Network, FileText } from "lucide-react";
import { agentRoles } from "../helpers/agentRoles";
import styles from "./agents.module.css";

export default function AgentsPage() {
  return (
    <>
      <Helmet><title>Agent team - Hey Buddy</title></Helmet>
      <div className={styles.pageHeading}>
        <span className={styles.eyebrow}>Your collaborators</span>
        <h1 className={styles.h1}>A small team. A wider perspective.</h1>
        <p className={styles.lede}>Five prompt-based specialists, coordinated by browser-adapted Ruflo entities.</p>
      </div>
      <div className={styles.banner}><Network size={18} strokeWidth={1.75} /><p>Runs use a dependency graph with up to two parallel stages, capability-based agent assignment, cancellation, and bounded retries. Agents generate text; they do not execute code or control external websites.</p></div>
      <div className={styles.grid}>
        {agentRoles.roles.map((a, i) => (
          <article className={styles.card} key={a.name}>
            <div className={styles.cardTop}><span className={styles.avatar} aria-hidden="true">{a.name.slice(0, 1)}</span><span className={styles.number}>0{i + 1}</span></div>
            <h2 className={styles.h2}>{a.name}</h2>
            <p className={styles.instruction}>{a.instruction}</p>
            <ul className={styles.caps}>{a.capabilities.map((c) => <li key={c}>{c}</li>)}</ul>
          </article>
        ))}
      </div>
      <div className={`${styles.banner} ${styles.bannerMuted}`}><FileText size={18} strokeWidth={1.75} /><p>What is reused: Ruflo's agent and task lifecycle model, its safe JSON handling, and an adapted capability-matching algorithm. This is not the full Ruflo CLI, MCP server, federation layer, AgentDB, or self-learning runtime.</p></div>
    </>
  );
}

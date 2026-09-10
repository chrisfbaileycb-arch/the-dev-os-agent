import React from "react";
import { Helmet } from "react-helmet";
import { Navigate } from "react-router-dom";
import { Zap } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/Tabs";
import { PasswordLoginForm } from "../components/PasswordLoginForm";
import { PasswordRegisterForm } from "../components/PasswordRegisterForm";
import { useAuth } from "../helpers/useAuth";
import styles from "./login.module.css";

export default function LoginPage() {
  const { authState } = useAuth();
  if (authState.type === "authenticated") return <Navigate to="/" replace />;
  return (
    <div className={styles.page}>
      <Helmet><title>Sign in - FreeToken Web</title></Helmet>
      <section className={styles.card}>
        <div className={styles.brand}><span className={styles.mark}><Zap size={18} strokeWidth={2} /></span><span className={styles.name}>FreeToken<span className={styles.edition}>Web</span></span></div>
        <h1 className={styles.title}>A whole team behind you.</h1>
        <p className={styles.lede}>Sign in to keep your runs and notes in your account. Provider keys stay in your browser session and are never stored.</p>
        <Tabs defaultValue="login" className={styles.tabs}>
          <TabsList className={styles.tabsList}>
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="register">Create account</TabsTrigger>
          </TabsList>
          <TabsContent value="login"><PasswordLoginForm /></TabsContent>
          <TabsContent value="register"><PasswordRegisterForm /></TabsContent>
        </Tabs>
      </section>
      <p className={styles.foot}>Demo mode runs scripted outputs with no model. Hosted runs use your own provider key.</p>
    </div>
  );
}

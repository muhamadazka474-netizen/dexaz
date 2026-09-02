"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "./api";

interface AuthState {
  username: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const PUBLIC_PATHS = ["/login"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("dbx_token") : null;
    const storedUsername = typeof window !== "undefined" ? localStorage.getItem("dbx_username") : null;

    if (!token) {
      setLoading(false);
      if (!PUBLIC_PATHS.includes(pathname)) router.replace("/login");
      return;
    }

    api
      .me()
      .then((me) => {
        setUsername(me.username);
        setLoading(false);
        if (pathname === "/login") router.replace("/dashboard");
      })
      .catch(() => {
        localStorage.removeItem("dbx_token");
        localStorage.removeItem("dbx_username");
        setLoading(false);
        if (!PUBLIC_PATHS.includes(pathname)) router.replace("/login");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(u: string, p: string) {
    const res = await api.login(u, p);
    localStorage.setItem("dbx_token", res.access_token);
    localStorage.setItem("dbx_username", res.username);
    setUsername(res.username);
    router.replace("/dashboard");
  }

  function logout() {
    localStorage.removeItem("dbx_token");
    localStorage.removeItem("dbx_username");
    setUsername(null);
    router.replace("/login");
  }

  return (
    <AuthContext.Provider value={{ username, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

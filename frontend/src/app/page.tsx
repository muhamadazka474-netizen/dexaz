"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function RootPage() {
  const router = useRouter();
  const { username, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(username ? "/dashboard" : "/login");
  }, [loading, username, router]);

  return null;
}

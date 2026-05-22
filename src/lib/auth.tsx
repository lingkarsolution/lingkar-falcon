import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { auth, type User, type Tenant } from "@/lib/api";

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => auth.me().catch(() => null),
    staleTime: 60_000,
  });
  const session = data?.user ? data : null;
  const [bootstrapping, setBootstrapping] = useState(true);
  useEffect(() => { if (!isLoading) setBootstrapping(false); }, [isLoading]);

  // Route guards
  useEffect(() => {
    if (bootstrapping) return;
    const onLogin = loc.pathname === "/login";
    if (!session && !onLogin) nav("/login", { replace: true });
    if (session && onLogin) nav("/", { replace: true });
  }, [session, bootstrapping, loc.pathname, nav]);

  const value: AuthState = {
    user: session?.user ?? null,
    tenant: session?.tenant ?? null,
    loading: bootstrapping,
    login: async (email, password) => {
      await auth.login(email, password);
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/", { replace: true });
    },
    logout: async () => {
      await auth.logout();
      qc.setQueryData(["me"], null);
      nav("/login", { replace: true });
    },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
};

export const useAuth = (): AuthState => {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
};

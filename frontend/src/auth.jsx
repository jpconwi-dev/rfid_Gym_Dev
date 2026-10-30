import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "./api";

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!localStorage.getItem("gym_token"));

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      localStorage.removeItem("gym_token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (localStorage.getItem("gym_token")) refresh();
  }, [refresh]);

  const login = async (username, password) => {
    const { token, user } = await api.login(username.trim().toLowerCase(), password);
    localStorage.setItem("gym_token", token);
    setUser(user);
    return user;
  };
  const logout = () => {
    localStorage.removeItem("gym_token");
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}

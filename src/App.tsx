import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Topics from "@/pages/Topics";
import TopicForm from "@/pages/TopicForm";
import TopicDetail from "@/pages/TopicDetail";
import Connectors from "@/pages/Connectors";
import IngestionJobs from "@/pages/IngestionJobs";
import Alerts from "@/pages/Alerts";
import Reports from "@/pages/Reports";
import Actors from "@/pages/Actors";
import Commander from "@/pages/Commander";
import Audit from "@/pages/Audit";
import Settings from "@/pages/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster richColors position="top-right" />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="topics" element={<Topics />} />
            <Route path="topics/form" element={<TopicForm />} />
            <Route path="topics/form/:id" element={<TopicForm />} />
            <Route path="topics/:id" element={<TopicDetail />} />
            <Route path="actors" element={<Actors />} />
            <Route path="connectors" element={<Connectors />} />
            <Route path="ingestion" element={<IngestionJobs />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="reports" element={<Reports />} />
            <Route path="commander" element={<Commander />} />
            <Route path="audit" element={<Audit />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

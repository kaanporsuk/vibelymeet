import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Events from "./pages/Events";
import Matches from "./pages/Matches";
import Chat from "./pages/Chat";
import Profile from "./pages/Profile";
import VideoDate from "./pages/VideoDate";
import NotFound from "./pages/NotFound";
import { NotificationProvider } from "./contexts/NotificationContext";
import NotificationContainer from "./components/notifications/NotificationContainer";
import NotificationDemo from "./components/notifications/NotificationDemo";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <NotificationProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner position="top-center" theme="dark" />
        <BrowserRouter>
          <NotificationContainer />
          <NotificationDemo />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/events" element={<Events />} />
            <Route path="/matches" element={<Matches />} />
            <Route path="/chat/:id" element={<Chat />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/date/:id" element={<VideoDate />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </NotificationProvider>
  </QueryClientProvider>
);

export default App;

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Onboarding from "./pages/Onboarding";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Events from "./pages/Events";
import EventDetails from "./pages/EventDetails";
import Matches from "./pages/Matches";
import Chat from "./pages/Chat";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import VideoDate from "./pages/VideoDate";
import VideoLobby from "./pages/VideoLobby";
import AdminCreateEvent from "./pages/AdminCreateEvent";
import MatchCelebration from "./pages/MatchCelebration";
import VibeStudio from "./pages/VibeStudio";
import VibeFeed from "./pages/VibeFeed";
import Schedule from "./pages/Schedule";
import HowItWorks from "./pages/HowItWorks";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminDashboard from "./pages/admin/AdminDashboard";
import { NotificationProvider } from "./contexts/NotificationContext";
import { AuthProvider } from "./contexts/AuthContext";
import NotificationContainer from "./components/notifications/NotificationContainer";
import { NotificationManager } from "./components/notifications/NotificationManager";
import { ProtectedRoute } from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <NotificationProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner position="top-center" theme="dark" />
          <BrowserRouter>
            <NotificationContainer />
            <NotificationManager />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />
              <Route path="/events/:id" element={<ProtectedRoute><EventDetails /></ProtectedRoute>} />
              <Route path="/matches" element={<ProtectedRoute><Matches /></ProtectedRoute>} />
              <Route path="/chat/:id" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/date/:id" element={<ProtectedRoute><VideoDate /></ProtectedRoute>} />
              <Route path="/lobby" element={<ProtectedRoute><VideoLobby /></ProtectedRoute>} />
              <Route path="/admin/create-event" element={<ProtectedRoute requireAdmin><AdminCreateEvent /></ProtectedRoute>} />
              <Route path="/match-celebration" element={<ProtectedRoute><MatchCelebration /></ProtectedRoute>} />
              <Route path="/vibe-studio" element={<ProtectedRoute><VibeStudio /></ProtectedRoute>} />
              <Route path="/vibe-feed" element={<ProtectedRoute><VibeFeed /></ProtectedRoute>} />
              <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              {/* Admin Routes */}
              <Route path="/kaan" element={<AdminLogin />} />
              <Route path="/kaan/dashboard" element={<ProtectedRoute requireAdmin requireOnboarding={false}><AdminDashboard /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </NotificationProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;

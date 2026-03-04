import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const VibeStudio = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    toast.info("Opening Vibe Studio from your profile...");
    navigate("/profile", { replace: true });
  }, [navigate]);
  
  return null;
};

export default VibeStudio;

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const VibeStudio = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    // Legacy compatibility route: keep old deep links working by forwarding to the profile owner surface.
    navigate("/profile", { replace: true });
  }, [navigate]);
  
  return null;
};

export default VibeStudio;

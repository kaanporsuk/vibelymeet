import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to onboarding for new users
    // In a real app, check if user is authenticated
    navigate("/onboarding");
  }, [navigate]);

  return null;
};

export default Index;

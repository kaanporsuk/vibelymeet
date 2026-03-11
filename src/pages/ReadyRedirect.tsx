import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

const ReadyRedirect = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    if (id) {
      navigate(`/event/${id}/lobby`, { replace: true });
    } else {
      navigate("/events", { replace: true });
    }
  }, [id, navigate]);

  return null;
};

export default ReadyRedirect;


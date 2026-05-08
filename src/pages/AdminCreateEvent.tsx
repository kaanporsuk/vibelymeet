import { Navigate } from "react-router-dom";

const AdminCreateEvent = () => {
  return <Navigate to="/kaan/dashboard?panel=events&create=event" replace />;
};

export default AdminCreateEvent;

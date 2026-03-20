import { useParams } from "react-router-dom";

function Conflicts() {
  const { sessionId } = useParams();

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-white">Conflicts</h3>
      <p className="mt-2 text-sm text-slate-300">Session ID: {sessionId}</p>
    </div>
  );
}

export default Conflicts;
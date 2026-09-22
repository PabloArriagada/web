import { usePath } from "./lib/router.js";
import { ProjectList } from "./pages/ProjectList.js";
import { Workspace } from "./pages/Workspace.js";

export function App() {
  const path = usePath();
  const m = /^\/projects\/(prj_[a-z0-9]+)\/?$/.exec(path);
  if (m) return <Workspace key={m[1]} projectId={m[1]!} />;
  return <ProjectList />;
}

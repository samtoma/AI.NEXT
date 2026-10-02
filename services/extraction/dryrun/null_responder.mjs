// The re-collection responder (recollect_lessons.py): an agent call the recorded run never made gets
// NO answer — as if the agent had returned nothing — so the script reports it as unchecked, never as
// agreement. recollect_lessons.py lists every such call and does not write its output unless told to.
export function respond() {
  return null
}

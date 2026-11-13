import { CheckIcon } from "../icons";

/** The glossy check on a picked tile (black in light mode, white in dark). */
export function PickedMark() {
  return (
    <span className="st-create-check" aria-hidden="true">
      <CheckIcon size={13} />
    </span>
  );
}

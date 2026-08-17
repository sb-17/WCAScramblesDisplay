import DisplayClient from "./display-client";

/**
 * The scrambling-area display. Deliberately outside the Delegate dashboard and with no WCA
 * sign-in: the tablet authenticates with its own device token, not as a person.
 */
export default function DisplayPage() {
  return <DisplayClient />;
}

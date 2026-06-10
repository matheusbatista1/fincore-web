/**
 * A contact for shared expenses (pessoa). The ledger balance — who owes whom — is
 * DERIVED from transaction splits and settlements (see person-ledger calculator),
 * never stored on the entity.
 */
export interface Person {
  readonly id: string;
  readonly name: string;
  /** Relationship label, e.g. "Namorada", "Amigo", "Mãe". */
  readonly relationship: string;
  /** Avatar color (hex). */
  readonly color: string;
}

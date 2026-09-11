import Link from "next/link";

type Membership = {
  id: string;
  studentCohort: {
    id: string;
    code: string | null;
    name: string;
    type: string;
    active: boolean;
  };
};

export function StudentCohorts({
  memberships,
}: {
  memberships: Membership[];
}) {
  return (
    <section className="master-subsection">
      <div className="master-subsection-header">
        <div>
          <span className="eyebrow">Membership</span>
          <h3>Cohorts / classes</h3>
        </div>

        <span className="master-muted">
          {memberships.length} memberships
        </span>
      </div>

      <div className="qualification-assignment-list">
        {memberships.length === 0 ? (
          <p className="master-muted master-list-message">
            This student is not assigned to a cohort.
          </p>
        ) : (
          memberships.map((membership) => (
            <Link
              key={membership.id}
              href={`/cohorts?id=${membership.studentCohort.id}`}
              className="master-relation-row"
            >
              <div>
                <strong>
                  {membership.studentCohort.code ?? "—"} ·{" "}
                  {membership.studentCohort.name}
                </strong>
                <span>
                  {membership.studentCohort.type}
                  {membership.studentCohort.active
                    ? ""
                    : " · inactive"}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

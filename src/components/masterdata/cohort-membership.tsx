import { Button } from "@/components/ui/button";
import {
  Field,
  SelectInput,
} from "@/components/masterdata/form-field";
import {
  addStudentToCohort,
  removeStudentFromCohort,
} from "@/lib/masterdata/student-cohort-location-actions";

type StudentOption = {
  id: string;
  firstName: string;
  lastName: string;
  externalId: string | null;
};

type CohortMember = {
  id: string;
  student: StudentOption;
};

type CohortMembershipProps = {
  cohortId: string;
  members: CohortMember[];
  availableStudents: StudentOption[];
};

export function CohortMembership({
  cohortId,
  members,
  availableStudents,
}: CohortMembershipProps) {
  const returnPath = `/cohorts?id=${cohortId}`;

  return (
    <section className="master-subsection">
      <div className="master-subsection-header">
        <div>
          <span className="eyebrow">Membership</span>
          <h3>Students</h3>
        </div>

        <span className="master-muted">
          {members.length} members
        </span>
      </div>

      <div className="qualification-assignment-list">
        {members.length === 0 ? (
          <p className="master-muted master-list-message">
            No students assigned to this cohort.
          </p>
        ) : (
          members.map((membership) => (
            <div
              key={membership.id}
              className="qualification-assignment-row"
            >
              <div>
                <strong>
                  {membership.student.firstName}{" "}
                  {membership.student.lastName}
                </strong>
                <span>
                  {membership.student.externalId ?? "No external ID"}
                </span>
              </div>

              <form action={removeStudentFromCohort}>
                <input
                  type="hidden"
                  name="membershipId"
                  value={membership.id}
                />
                <input
                  type="hidden"
                  name="returnPath"
                  value={returnPath}
                />

                <Button type="submit" variant="ghost">
                  Remove
                </Button>
              </form>
            </div>
          ))
        )}
      </div>

      {availableStudents.length > 0 ? (
        <form
          action={addStudentToCohort}
          className="master-inline-form cohort-member-add-form"
        >
          <input
            type="hidden"
            name="studentCohortId"
            value={cohortId}
          />
          <input
            type="hidden"
            name="returnPath"
            value={returnPath}
          />

          <Field label="Add student">
            <SelectInput
              name="studentId"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Select student
              </option>
              {availableStudents.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.lastName}, {student.firstName}
                  {student.externalId
                    ? ` · ${student.externalId}`
                    : ""}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Button type="submit" variant="secondary">
            Add to cohort
          </Button>
        </form>
      ) : null}
    </section>
  );
}

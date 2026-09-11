import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import {
  assignInstructorQualification,
  toggleInstructorQualification,
} from "@/lib/masterdata/actions";

type QualificationOption = {
  id: string;
  code: string;
  name: string;
};

type AssignedQualification = {
  id: string;
  level: number;
  active: boolean;
  qualification: QualificationOption;
};

type InstructorQualificationsProps = {
  instructorId: string;
  assigned: AssignedQualification[];
  available: QualificationOption[];
};

export function InstructorQualifications({
  instructorId,
  assigned,
  available,
}: InstructorQualificationsProps) {
  return (
    <section className="master-subsection">
      <div className="master-subsection-header">
        <div>
          <span className="eyebrow">
            Competence
          </span>
          <h3>Qualifications</h3>
        </div>

        <Badge tone="info">
          {assigned.filter((item) => item.active).length} active
        </Badge>
      </div>

      <div className="qualification-assignment-list">
        {assigned.length === 0 ? (
          <p className="master-muted">
            No qualifications assigned yet.
          </p>
        ) : (
          assigned.map((item) => (
            <div
              key={item.id}
              className="qualification-assignment-row"
              data-inactive={!item.active}
            >
              <div>
                <strong>
                  {item.qualification.code}
                </strong>
                <span>
                  {item.qualification.name} · level {item.level}
                </span>
              </div>

              <form action={toggleInstructorQualification}>
                <input
                  type="hidden"
                  name="id"
                  value={item.id}
                />
                <input
                  type="hidden"
                  name="instructorId"
                  value={instructorId}
                />
                <input
                  type="hidden"
                  name="active"
                  value={String(!item.active)}
                />

                <Button
                  type="submit"
                  variant="ghost"
                >
                  {item.active ? "Deactivate" : "Reactivate"}
                </Button>
              </form>
            </div>
          ))
        )}
      </div>

      <form
        action={assignInstructorQualification}
        className="master-inline-form qualification-create-form"
      >
        <input
          type="hidden"
          name="instructorId"
          value={instructorId}
        />

        <Field label="Qualification">
          <SelectInput
            name="qualificationId"
            required
            defaultValue=""
          >
            <option value="" disabled>
              Select qualification
            </option>
            {available.map((qualification) => (
              <option
                key={qualification.id}
                value={qualification.id}
              >
                {qualification.code} · {qualification.name}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Level">
          <TextInput
            name="level"
            type="number"
            min={1}
            defaultValue={1}
          />
        </Field>

        <Button
          type="submit"
          variant="secondary"
        >
          Assign / update
        </Button>
      </form>
    </section>
  );
}

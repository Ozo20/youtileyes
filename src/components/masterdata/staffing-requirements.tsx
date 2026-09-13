import {
  StaffingRequirementSource,
  StaffingRoleType,
} from "@/generated/prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import {
  createStaffingRequirement,
  toggleStaffingRequirement,
} from "@/lib/masterdata/actions";

type QualificationOption = {
  id: string;
  code: string;
  name: string;
};

type StaffingRule = {
  id: string;
  role: StaffingRoleType;
  count: number;
  minimumQualificationLevel: number | null;
  minimumCourseLevel?: number | null;
  preferredCourseLevel?: number | null;
  minimumStudentCount: number | null;
  hard: boolean;
  active: boolean;
  requiredQualification: QualificationOption | null;
};

type StaffingRequirementsProps = {
  source: "COURSE" | "ROOM";
  targetId: string;
  returnPath: string;
  rules: StaffingRule[];
  qualifications: QualificationOption[];
};

export function StaffingRequirements({
  source,
  targetId,
  returnPath,
  rules,
  qualifications,
}: StaffingRequirementsProps) {
  return (
    <section className="master-subsection">
      <div className="master-subsection-header">
        <div>
          <span className="eyebrow">Staffing</span>
          <h3>Requirements</h3>
        </div>

        <Badge tone="info">
          {rules.filter((rule) => rule.active).length} active
        </Badge>
      </div>

      <div className="staffing-rule-list">
        {rules.length === 0 ? (
          <p className="master-muted">
            No explicit staffing requirements. The solver will use its default
            single-lead behavior.
          </p>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="staffing-rule-row"
              data-inactive={!rule.active}
            >
              <div>
                <strong>
                  {rule.count} × {rule.role}
                </strong>

                <span>
                  {rule.requiredQualification
                    ? `${rule.requiredQualification.code} ≥ level ${rule.minimumQualificationLevel ?? 1}`
                    : "No additional qualification"}
                  {rule.minimumStudentCount
                    ? ` · from ${rule.minimumStudentCount} students`
                    : ""}
                  {rule.hard ? " · hard" : " · soft"}
                  {rule.minimumCourseLevel != null &&
                    ` · course level ≥ ${rule.minimumCourseLevel}`}
                  {rule.preferredCourseLevel != null &&
                    ` · preferred course level ${rule.preferredCourseLevel}`}
                </span>
              </div>

              <form action={toggleStaffingRequirement}>
                <input type="hidden" name="id" value={rule.id} />
                <input
                  type="hidden"
                  name="active"
                  value={String(!rule.active)}
                />
                <input type="hidden" name="returnPath" value={returnPath} />

                <Button type="submit" variant="ghost">
                  {rule.active ? "Deactivate" : "Reactivate"}
                </Button>
              </form>
            </div>
          ))
        )}
      </div>

      <form
        action={createStaffingRequirement}
        className="master-inline-form staffing-create-form"
      >
        <input
          type="hidden"
          name="source"
          value={
            source === "COURSE"
              ? StaffingRequirementSource.COURSE
              : StaffingRequirementSource.ROOM
          }
        />

        {source === "COURSE" ? (
          <input type="hidden" name="courseId" value={targetId} />
        ) : (
          <input type="hidden" name="roomId" value={targetId} />
        )}

        <Field label="Role">
          <SelectInput name="role" defaultValue={StaffingRoleType.ASSISTANT}>
            {Object.values(StaffingRoleType).map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Count">
          <TextInput name="count" type="number" min={1} defaultValue={1} />
        </Field>

        <Field label="Qualification">
          <SelectInput name="requiredQualificationId" defaultValue="">
            <option value="">No additional qualification</option>
            {qualifications.map((qualification) => (
              <option key={qualification.id} value={qualification.id}>
                {qualification.code} · {qualification.name}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Minimum course competence level">
          <TextInput
            name="minimumCourseLevel"
            type="number"
            min={1}
            max={100}
          />
        </Field>
        <Field label="Preferred course competence level">
          <TextInput
            name="preferredCourseLevel"
            type="number"
            min={1}
            max={100}
          />
        </Field>
        <Field label="Min. level">
          <TextInput
            name="minimumQualificationLevel"
            type="number"
            min={1}
            placeholder="1"
          />
        </Field>

        <Field label="Students ≥" hint="Optional trigger">
          <TextInput
            name="minimumStudentCount"
            type="number"
            min={1}
            placeholder="Any size"
          />
        </Field>

        <div className="staffing-create-footer">
          <CheckboxField name="hard" label="Hard requirement" defaultChecked />

          <Button type="submit" variant="secondary">
            Add requirement
          </Button>
        </div>
      </form>
    </section>
  );
}

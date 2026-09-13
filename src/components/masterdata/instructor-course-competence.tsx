"use client";

import { useState } from "react";

import {
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import { Button } from "@/components/ui/button";
import {
  saveCourseCompetence,
  togglePreference,
} from "@/lib/masterdata/preference-actions";

type CourseOption = {
  id: string;
  code: string | null;
  name: string;
};

type Assignment = {
  id: string;
  courseId: string;
  competenceLevel: number | null;
  qualificationLevel: "PRIMARY" | "SECONDARY" | "SUPPORT";
  preference: "PREFER" | "NEUTRAL" | "AVOID";
  preferenceWeight: number;
  active: boolean;
  validFrom: Date | null;
  validTo: Date | null;
  course: CourseOption;
};

type Props = {
  instructorId: string;
  assigned: Assignment[];
  courses: CourseOption[];
};

function roleLabel(value: Assignment["qualificationLevel"]) {
  if (value === "PRIMARY") return "Primary";
  if (value === "SECONDARY") return "Secondary";
  return "Support";
}

function preferenceLabel(value: Assignment["preference"]) {
  if (value === "PREFER") return "Prefer";
  if (value === "AVOID") return "Avoid if possible";
  return "Neutral";
}

function dateValue(value: Date | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export function InstructorCourseCompetence({
  instructorId,
  assigned,
  courses,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const assignedCourseIds = new Set(assigned.map((item) => item.courseId));

  const available = courses.filter(
    (course) => !assignedCourseIds.has(course.id),
  );

  return (
    <section className="master-subsection course-competence-section">
      <div className="master-subsection-header">
        <div>
          <span className="eyebrow">Teaching competence</span>
          <h3>Subjects this instructor can teach</h3>
          <p className="master-muted">
            Subject role, competence and teaching preference used by the
            planning solver.
          </p>
        </div>

        {!adding && available.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
          >
            Add subject
          </Button>
        ) : null}
      </div>

      {adding ? (
        <div className="course-competence-editor">
          <div className="course-competence-editor-header">
            <div>
              <strong>Add teaching competence</strong>
              <span>Select a subject and define the instructor's level.</span>
            </div>
          </div>

          <form
            action={saveCourseCompetence}
            className="master-inline-form course-competence-form"
          >
            <input type="hidden" name="instructorId" value={instructorId} />

            <Field label="Subject">
              <SelectInput name="courseId" defaultValue="" required>
                <option value="" disabled>
                  Select subject
                </option>

                {available.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code
                      ? `${course.code} · ${course.name}`
                      : course.name}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label="Subject role">
              <SelectInput
                name="qualificationLevel"
                defaultValue="PRIMARY"
                required
              >
                <option value="PRIMARY">Primary</option>
                <option value="SECONDARY">Secondary</option>
                <option value="SUPPORT">Support</option>
              </SelectInput>
            </Field>

            <Field label="Competence" hint="1–100">
              <TextInput
                name="competenceLevel"
                type="number"
                min={1}
                max={100}
                required
                defaultValue={80}
              />
            </Field>

            <Field label="Preference">
              <SelectInput name="preference" defaultValue="NEUTRAL" required>
                <option value="PREFER">Prefer</option>
                <option value="NEUTRAL">Neutral</option>
                <option value="AVOID">Avoid if possible</option>
              </SelectInput>
            </Field>

            <input type="hidden" name="preferenceWeight" value="100" />

            <div className="course-competence-form-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>

              <Button type="submit" variant="secondary">
                Add
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="qualification-assignment-list">
        {assigned.length === 0 ? (
          <p className="master-muted">No teaching competence registered yet.</p>
        ) : (
          assigned.map((item) => {
            const editing = editingId === item.id;

            return (
              <div
                key={item.id}
                className="course-competence-item"
                data-inactive={!item.active}
              >
                <div className="qualification-assignment-row">
                  <div className="course-competence-summary">
                    <strong>
                      {item.course.code
                        ? `${item.course.code} · ${item.course.name}`
                        : item.course.name}
                    </strong>

                    <span>
                      {roleLabel(item.qualificationLevel)}
                      {" · "}
                      competence {item.competenceLevel ?? "unspecified"}
                      {" · "}
                      {preferenceLabel(item.preference)}
                      {!item.active ? " · inactive" : ""}
                    </span>
                  </div>

                  <div className="course-competence-row-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setAdding(false);
                        setEditingId(editing ? null : item.id);
                      }}
                    >
                      {editing ? "Cancel" : "Edit"}
                    </Button>

                    <form action={togglePreference}>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="kind" value="competence" />

                      <Button type="submit" variant="ghost">
                        {item.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </form>
                  </div>
                </div>

                {editing ? (
                  <div className="course-competence-editor">
                    <form
                      action={saveCourseCompetence}
                      className="master-inline-form course-competence-edit-form"
                    >
                      <input
                        type="hidden"
                        name="instructorId"
                        value={instructorId}
                      />
                      <input
                        type="hidden"
                        name="courseId"
                        value={item.courseId}
                      />

                      <Field label="Subject role">
                        <SelectInput
                          name="qualificationLevel"
                          defaultValue={item.qualificationLevel}
                          required
                        >
                          <option value="PRIMARY">Primary</option>
                          <option value="SECONDARY">Secondary</option>
                          <option value="SUPPORT">Support</option>
                        </SelectInput>
                      </Field>

                      <Field label="Competence" hint="1–100">
                        <TextInput
                          name="competenceLevel"
                          type="number"
                          min={1}
                          max={100}
                          required
                          defaultValue={item.competenceLevel ?? 1}
                        />
                      </Field>

                      <Field label="Preference">
                        <SelectInput
                          name="preference"
                          defaultValue={item.preference}
                          required
                        >
                          <option value="PREFER">Prefer</option>
                          <option value="NEUTRAL">Neutral</option>
                          <option value="AVOID">Avoid if possible</option>
                        </SelectInput>
                      </Field>

                      <Field label="Preference priority">
                        <SelectInput
                          name="preferenceWeight"
                          defaultValue={String(item.preferenceWeight)}
                        >
                          <option value="10">Low</option>
                          <option value="100">Normal</option>
                          <option value="1000">High</option>
                        </SelectInput>
                      </Field>

                      <Field label="Valid from">
                        <TextInput
                          name="validFrom"
                          type="date"
                          defaultValue={dateValue(item.validFrom)}
                        />
                      </Field>

                      <Field label="Valid to">
                        <TextInput
                          name="validTo"
                          type="date"
                          defaultValue={dateValue(item.validTo)}
                        />
                      </Field>

                      <div className="course-competence-form-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>

                        <Button type="submit" variant="secondary">
                          Save changes
                        </Button>
                      </div>
                    </form>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {!adding && available.length === 0 ? (
        <p className="master-muted course-competence-all-assigned">
          All active subjects are registered for this instructor.
        </p>
      ) : null}
    </section>
  );
}

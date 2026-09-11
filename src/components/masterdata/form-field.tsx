import type {

  CSSProperties,

  InputHTMLAttributes,

  ReactNode,

  SelectHTMLAttributes,

  TextareaHTMLAttributes,

} from "react";

const STANDARD_CONTROL_HEIGHT = 42;

const standardControlStyle: CSSProperties = {

  width: "100%",

  height: `${STANDARD_CONTROL_HEIGHT}px`,

  minHeight: `${STANDARD_CONTROL_HEIGHT}px`,

  maxHeight: `${STANDARD_CONTROL_HEIGHT}px`,

  boxSizing: "border-box",

};

type FieldProps = {

  label: string;

  hint?: string;

  children: ReactNode;

};

export function Field({

  label,

  hint,

  children,

}: FieldProps) {

  return (

    <label className="master-field">

      <span className="master-field-label">

        {label}

      </span>

      {children}

      {hint ? (

        <small className="master-field-hint">

          {hint}

        </small>

      ) : null}

    </label>

  );

}

export function TextInput(

  props: InputHTMLAttributes<HTMLInputElement>,

) {

  return (

    <input

      {...props}

      className={`master-input ${props.className ?? ""}`}

      style={{

        ...props.style,

        ...standardControlStyle,

      }}

    />

  );

}

export function SelectInput(

  props: SelectHTMLAttributes<HTMLSelectElement>,

) {

  return (

    <select

      {...props}

      className={`master-input master-select ${props.className ?? ""}`}

      style={{

        ...props.style,

        ...standardControlStyle,

        appearance: "none",

        WebkitAppearance: "none",

      }}

    />

  );

}

export function TextArea(

  props: TextareaHTMLAttributes<HTMLTextAreaElement>,

) {

  return (

    <textarea

      {...props}

      className={`master-input master-textarea ${props.className ?? ""}`}

      style={{

        ...props.style,

        width: "100%",

        height: "auto",

        minHeight: "88px",

        boxSizing: "border-box",

      }}

    />

  );

}

export function CheckboxField({

  name,

  label,

  defaultChecked = false,

}: {

  name: string;

  label: string;

  defaultChecked?: boolean;

}) {

  return (

    <label className="master-checkbox">

      <input

        type="checkbox"

        name={name}

        defaultChecked={defaultChecked}

      />

      <span>{label}</span>

    </label>

  );

}
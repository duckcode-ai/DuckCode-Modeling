/* Icon set — constraints, relationships, cardinality. Ported from DataLex design prototype. */
import React from "react";

const S = (d, o = {}) =>
  React.createElement(
    "svg",
    Object.assign(
      {
        width: 14,
        height: 14,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.4,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
      o
    ),
    React.createElement("path", { d })
  );

/* Constraint icons */
export const Key = (p) =>
  S("M10 3.5a2.5 2.5 0 1 1-2.45 3H5v1.5H3.5V9.5H2V7l5.55-.5A2.5 2.5 0 0 1 10 3.5Z", p);
export const Link = (p) =>
  S(
    "M9 7a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 1 0 3.5 3.5l.5-.5 M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 1 0-3.5-3.5l-.5.5",
    p
  );
export const Unique = (p) =>
  S("M8 2v12 M4 6l4-4 4 4 M4 10l4 4 4-4", Object.assign({ strokeWidth: 1.2 }, p));
export const Hash = (p) => S("M3 6h10 M3 10h10 M6 3l-1 10 M11 3l-1 10", p);
export const Check2 = (p) =>
  S(
    "M2 8c1 0 2-.5 3-2.5S7 3 8 3s1.5 1 2.5 2.5S13 8 14 8 M2 3h12 M2 13h12",
    Object.assign({ strokeWidth: 1.1 }, p)
  );
export const Default = (p) => S("M3 3h8l2 2v8H3z M7 9h2 M7 7h4 M7 11h2", p);
// Document-with-lines shape, used by the Docs view-mode tab.
export const FileText = (p) => S("M3 2h7l3 3v9H3z M6 7h6 M6 9h6 M6 11h4", p);
export const NotNull = (p) => S("M3 3v10 M3 3l7 7-1 1V8h4", Object.assign({ strokeWidth: 1.6 }, p));
export const Generated = (p) =>
  S(
    "M3 8a5 5 0 0 1 10 0 M13 8l-2-2 M13 8l2-2 M13 8a5 5 0 0 1-10 0 M3 8l-2 2 M3 8l2 2",
    Object.assign({ strokeWidth: 1.2 }, p)
  );
export const Partition = (p) => S("M2 3h12v10H2z M2 7h12 M6 7v6 M10 7v6", p);
export const Identity = (p) => S("M8 2v12 M4 6l4-4 4 4", p);
export const Fingerprint = (p) =>
  S(
    "M5 13c0-2 0-4 3-4s3 2 3 4 M3 10c0-4 2-7 5-7s5 3 5 7 M5 5c1-1 2-1.5 3-1.5S10 4 11 5",
    Object.assign({ strokeWidth: 1.1 }, p)
  );

/* Cardinality */
export const CardOne = (p) => S("M8 4v8 M3 8h10 M6 6v4", Object.assign({ strokeWidth: 1.3 }, p));
export const CardMany = (p) =>
  S("M8 4v8 M3 8h10 M11 5l2 3-2 3", Object.assign({ strokeWidth: 1.3 }, p));
export const CardOpt = (p) =>
  S(
    "M3 8h4 M9 8h4 M8 8m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
    Object.assign({ strokeWidth: 1.2 }, p)
  );
export const CardReq = (p) => S("M3 8h10 M6 5v6 M6 5v6", Object.assign({ strokeWidth: 1.4 }, p));

/* FK actions */
export const Cascade = (p) =>
  S("M3 4h5a2 2 0 0 1 2 2v5 M8 11l2 2 2-2 M3 4l2-2 M3 4l2 2", p);
export const Restrict = (p) => S("M3 8h10 M3 4l10 8 M3 12l10-8", Object.assign({ strokeWidth: 1.2 }, p));
export const SetNull = (p) => S("M3 8a5 5 0 1 1 10 0 5 5 0 0 1-10 0Z M4 4l8 8", p);
export const NoAction = (p) => S("M2 8a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z", p);

/* Relationship kind */
export const OneToOne = (p) =>
  S("M3 5v6 M3 5v6 M13 5v6 M13 5v6 M3 8h10", Object.assign({ strokeWidth: 1.3 }, p));
export const OneToMany = (p) =>
  S("M3 5v6 M3 5v6 M13 8l-3-3 M13 8l-3 3 M13 8H3", Object.assign({ strokeWidth: 1.3 }, p));
export const ManyToOne = (p) =>
  S("M13 5v6 M13 5v6 M3 8l3-3 M3 8l3 3 M3 8h10", Object.assign({ strokeWidth: 1.3 }, p));
export const ManyToMany = (p) =>
  S(
    "M3 8l3-3 M3 8l3 3 M13 8l-3-3 M13 8l-3 3 M3 8h10",
    Object.assign({ strokeWidth: 1.3 }, p)
  );
export const SelfRef = (p) =>
  S("M5 8a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z M8 5V3 M8 3l-2 2 M8 3l2 2", p);
export const Identifying = (p) =>
  S("M2 8h12 M2 5h12 M2 11h12", Object.assign({ strokeWidth: 1.2 }, p));
export const NonIdent = (p) =>
  S("M2 8h3 M6 8h1 M8 8h1 M10 8h1 M12 8h2", Object.assign({ strokeWidth: 1.2 }, p));
export const Polymorphic = (p) =>
  S(
    "M8 2l5 3v6l-5 3-5-3V5z M8 2v12 M3 5l10 6 M3 11l10-6",
    Object.assign({ strokeWidth: 1.1 }, p)
  );
export const Inheritance = (p) => S("M8 2l4 4H4z M8 6v8", p);

/* Object icons */
export const Table = (p) => S("M2 3h12v10H2z M2 7h12 M2 11h12 M6 3v10 M10 3v10", p);
export const View = (p) =>
  S(
    "M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    p
  );
export const Func = (p) => S("M10 3c-1.5 0-2 1-2.2 2.5L6 13c-.2 1.5-.7 2-2 2 M4 8h6.5", p);
export const Enum = (p) => S("M3 4h10 M3 8h10 M3 12h6", p);
export const Junction = (p) => S("M2 3h5v5H2z M9 8h5v5H9z M7 5h3 M5 7v3", p);

/* UI icons */
export const Search = (p) => S("M7 13A6 6 0 1 0 7 1a6 6 0 0 0 0 12Z M14 14l-2.5-2.5", p);
export const Plus = (p) => S("M8 3v10 M3 8h10", p);
export const Minus = (p) => S("M3 8h10", p);
export const X = (p) => S("M4 4l8 8 M12 4l-8 8", p);
export const Chevron = (p) => S("M6 4l4 4-4 4", p);
export const ChevronDown = (p) => S("M4 6l4 4 4-4", p);
export const More = (p) => S("M3 8h.01 M8 8h.01 M13 8h.01", Object.assign({ strokeWidth: 2 }, p));
export const Copy = (p) => S("M5 5h7v7H5z M3 3h7v2 M3 3v7h2", p);
export const Edit = (p) => S("M3 13l3-1 8-8-2-2-8 8-1 3Z", p);
export const Trash = (p) => S("M3 5h10 M5 5V3h6v2 M5 5l1 9h4l1-9", p);
export const Filter = (p) => S("M2 3h12l-4.5 5.5V13l-3-1.5V8.5L2 3Z", p);
export const Download = (p) => S("M8 2v9 M4 8l4 4 4-4 M3 13h10", p);
export const Undo = (p) => S("M3 7h8a3 3 0 0 1 0 6H7 M3 7l3-3 M3 7l3 3", p);
export const Redo = (p) => S("M13 7H5a3 3 0 0 0 0 6h4 M13 7l-3-3 M13 7l-3 3", p);
export const Fit = (p) => S("M3 5V3h2 M11 3h2v2 M13 11v2h-2 M5 13H3v-2 M5 5h6v6H5z", p);
export const Grid = (p) => S("M3 3h10v10H3z M3 7h10 M3 11h10 M7 3v10 M11 3v10", p);
export const Layers = (p) =>
  S("M8 2l6 3-6 3-6-3 6-3Z M2 8l6 3 6-3 M2 11l6 3 6-3", p);
export const Play = (p) => S("M5 3l8 5-8 5z", p);
export const Check = (p) => S("M3 8l3 3 7-7", p);
export const Arrow = (p) => S("M3 8h10 M10 5l3 3-3 3", p);
export const Db = (p) =>
  S(
    "M8 3c3 0 5 .8 5 2v6c0 1.2-2 2-5 2s-5-.8-5-2V5c0-1.2 2-2 5-2Z M3 5c0 1.2 2 2 5 2s5-.8 5-2 M3 8c0 1.2 2 2 5 2s5-.8 5-2",
    p
  );
export const Branch = (p) =>
  S(
    "M5 3v10 M11 3v4a3 3 0 0 1-3 3H5 M11 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z M5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z M5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
    p
  );
export const Cmd = (p) =>
  S(
    "M5 5h6v6H5z M5 5V3.5A1.5 1.5 0 1 0 3.5 5H5 M11 5h1.5A1.5 1.5 0 1 0 11 3.5V5 M11 11h1.5a1.5 1.5 0 1 1-1.5 1.5V11 M5 11V12.5A1.5 1.5 0 1 1 3.5 11H5",
    p
  );
export const Relation = (p) =>
  S("M3 4v8 M13 4v8 M5 4h-2 M5 12h-2 M11 4h2 M11 12h2 M3 8h10", p);
export const Folder = (p) =>
  S(
    "M2 4.5A1.5 1.5 0 0 1 3.5 3h3L8 4.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5V4.5Z",
    p
  );
export const Eye = (p) =>
  S(
    "M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    p
  );
export const Settings = (p) =>
  S(
    "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M8 2v1.5 M8 12.5V14 M2 8h1.5 M12.5 8H14 M3.76 3.76l1.06 1.06 M11.18 11.18l1.06 1.06 M3.76 12.24l1.06-1.06 M11.18 4.82l1.06-1.06",
    p
  );
export const Sparkle = (p) =>
  S("M8 2v4 M8 10v4 M2 8h4 M10 8h4", Object.assign({ strokeWidth: 1.6 }, p));
export const Bell = (p) =>
  S("M8 2a4 4 0 0 0-4 4v3l-1 2h10l-1-2V6a4 4 0 0 0-4-4Z M6 13a2 2 0 0 0 4 0", p);
export const Info = (p) =>
  S("M2 8a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z M8 7v4 M8 5h.01", Object.assign({ strokeWidth: 1.4 }, p));
export const Dep = (p) => S("M4 3h6l3 3v7H4z M10 3v3h3", p);

/* Default-export bag so existing code can `import Icon from "..."` and use Icon.Key, etc. */
const Icon = {
  Key, Link, Unique, Hash, Check2, Default, NotNull, Generated, Partition, Identity, Fingerprint,
  CardOne, CardMany, CardOpt, CardReq,
  Cascade, Restrict, SetNull, NoAction,
  OneToOne, OneToMany, ManyToOne, ManyToMany, SelfRef, Identifying, NonIdent, Polymorphic, Inheritance,
  Table, View, Func, Enum, Junction,
  Search, Plus, Minus, X, Chevron, ChevronDown, More, Copy, Edit, Trash, Filter, Download,
  Undo, Redo, Fit, Grid, Layers, Play, Check, Arrow, Db, Branch, Cmd, Relation, Folder,
  Eye, Settings, Sparkle, Bell, Info, Dep,
  FileText,
};
export default Icon;

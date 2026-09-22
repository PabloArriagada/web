import { describe, expect, it } from "vitest";
import { Scorm12Adapter, Scorm2004Adapter, Tracker, formatScorm12Time, formatScorm2004Time } from "../src/index.js";
import { createMockLms, createMockStore } from "../src/lms/mock-api.js";
import type { Scorm12Api, Scorm2004Api } from "../src/index.js";

describe("LMS simulado", () => {
  it("SCORM 1.2: ciclo de vida y códigos de error", () => {
    const lms = createMockLms("scorm12");
    const api = lms.api as Scorm12Api;
    expect(api.LMSGetValue("cmi.core.lesson_status")).toBe("");
    expect(api.LMSGetLastError()).toBe("301");
    expect(api.LMSInitialize("")).toBe("true");
    expect(api.LMSInitialize("")).toBe("false");
    expect(api.LMSSetValue("cmi.core.student_id", "x")).toBe("false");
    expect(api.LMSGetLastError()).toBe("403");
    expect(api.LMSGetValue("cmi.core.exit")).toBe("");
    expect(api.LMSGetLastError()).toBe("404");
    expect(api.LMSSetValue("cmi.core.lesson_status", "terminado")).toBe("false");
    expect(api.LMSGetLastError()).toBe("405");
    expect(api.LMSSetValue("cmi.suspend_data", "x".repeat(4097))).toBe("false");
    expect(api.LMSFinish("")).toBe("true");
    expect(api.LMSCommit("")).toBe("false");
  });

  it("SCORM 2004: dependencia de interacciones y rangos", () => {
    const lms = createMockLms("scorm2004");
    const api = lms.api as Scorm2004Api;
    api.Initialize("");
    expect(api.SetValue("cmi.interactions.0.result", "correct")).toBe("false");
    expect(api.GetLastError()).toBe("408");
    expect(api.SetValue("cmi.interactions.0.id", "q1")).toBe("true");
    expect(api.GetValue("cmi.interactions._count")).toBe("1");
    expect(api.SetValue("cmi.interactions.5.id", "q5")).toBe("false");
    expect(api.SetValue("cmi.score.scaled", "1.5")).toBe("false");
    expect(api.GetLastError()).toBe("406");
    expect(api.Terminate("")).toBe("true");
    expect(api.Terminate("")).toBe("false");
    expect(api.GetLastError()).toBe("113");
  });

  it("persiste entre lanzamientos solo si la salida fue suspend", () => {
    const store = createMockStore();
    const a = createMockLms("scorm2004", store).api as Scorm2004Api;
    a.Initialize("");
    a.SetValue("cmi.location", "sld_1");
    a.SetValue("cmi.exit", "suspend");
    a.Terminate("");
    const b = createMockLms("scorm2004", store).api as Scorm2004Api;
    b.Initialize("");
    expect(b.GetValue("cmi.entry")).toBe("resume");
    expect(b.GetValue("cmi.location")).toBe("sld_1");
    b.SetValue("cmi.exit", "normal");
    b.Terminate("");
    const c = createMockLms("scorm2004", store).api as Scorm2004Api;
    c.Initialize("");
    expect(c.GetValue("cmi.entry")).toBe("ab-initio");
    expect(c.GetValue("cmi.location")).toBe("");
  });
});

describe("Tracker", () => {
  it("SCORM 1.2: mapea estado, ubicación, puntaje, interacciones y cierre", () => {
    const lms = createMockLms("scorm12");
    const t = new Tracker(new Scorm12Adapter(lms.api as Scorm12Api));
    const launch = t.start();
    expect(launch.entry).toBe("ab-initio");
    expect(lms.snapshot()["cmi.core.lesson_status"]).toBe("incomplete");
    t.setLocation("sld_abc");
    expect(t.setSuspendData("{}")).toBe(true);
    expect(t.setSuspendData("x".repeat(5000))).toBe(false);
    t.setScore(85);
    t.recordInteraction({ id: "pregunta 1", type: "true-false", response: ["true"], correctResponse: ["true"], result: "correct", latencyMs: 3500 });
    t.recordInteraction({ id: "q2", type: "choice", response: ["a", "c"], result: "incorrect" });
    t.setCompleted();
    t.finish();
    const s = lms.snapshot();
    expect(s["cmi.core.lesson_location"]).toBe("sld_abc");
    expect(s["cmi.core.score.raw"]).toBe("85");
    expect(s["cmi.core.lesson_status"]).toBe("completed");
    expect(s["cmi.interactions.0.id"]).toBe("pregunta_1");
    expect(s["cmi.interactions.0.student_response"]).toBe("t");
    expect(s["cmi.interactions.1.student_response"]).toBe("a,c");
    expect(s["cmi.interactions.1.result"]).toBe("wrong");
    expect(s["cmi.core.exit"]).toBe("suspend");
    expect(s["cmi.core.session_time"]).toMatch(/^\d{4}:\d{2}:\d{2}\.\d{2}$/);
    expect(t.errors.filter((e) => !e.includes("suspend_data"))).toEqual([]);
    expect(lms.state()).toBe("terminated");
  });

  it("SCORM 2004: completion, success, scaled y progress", () => {
    const lms = createMockLms("scorm2004");
    const t = new Tracker(new Scorm2004Adapter(lms.api as Scorm2004Api));
    t.start();
    t.setProgress(0.5);
    t.setScore(40, 0, 50);
    t.setSuccess(true);
    t.recordInteraction({ id: "q1", type: "choice", response: ["a", "b"], result: "correct", description: "Pregunta" });
    t.setCompleted();
    t.finish();
    const s = lms.snapshot();
    expect(s["cmi.completion_status"]).toBe("completed");
    expect(s["cmi.success_status"]).toBe("passed");
    expect(s["cmi.score.scaled"]).toBe("0.8000");
    expect(s["cmi.progress_measure"]).toBe("0.5000");
    expect(s["cmi.interactions.0.learner_response"]).toBe("a[,]b");
    expect(s["cmi.session_time"]).toMatch(/^PT\d+H\d+M[\d.]+S$/);
    expect(t.errors).toEqual([]);
  });

  it("no degrada passed a completed en 1.2", () => {
    const lms = createMockLms("scorm12");
    const t = new Tracker(new Scorm12Adapter(lms.api as Scorm12Api));
    t.start();
    t.setSuccess(true);
    t.setCompleted();
    expect(lms.snapshot()["cmi.core.lesson_status"]).toBe("passed");
  });

  it("formatos de tiempo", () => {
    expect(formatScorm12Time(3_723_450)).toBe("0001:02:03.45");
    expect(formatScorm2004Time(3_723_450)).toBe("PT1H2M3.45S");
    expect(formatScorm2004Time(0)).toBe("PT0H0M0S");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import "../settings/testDom.ts";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchableSelectField } from "./SearchableSelectField.tsx";

afterEach(cleanup);

describe("SearchableSelectField", () => {
  test("filters a long choice list and commits only a listed option", async () => {
    const changes: string[] = [];
    const user = userEvent.setup();
    const view = render(
      <SearchableSelectField
        label="Default Workflow Skill"
        value=""
        options={[
          { value: "skill-build", label: "build-feature (project)" },
          { value: "skill-review", label: "review-round (project)" },
          { value: "skill-verify", label: "final-verify (user)" },
        ]}
        onChange={(value) => changes.push(value)}
        placeholder="Select a validated Skill"
        emptyMessage="No matching Workflow Skills"
      />,
    );

    const search = view.getByRole("combobox", { name: "Default Workflow Skill" });
    expect((search as HTMLInputElement).value).toBe("");
    expect(search.getAttribute("placeholder")).toBe("Select a validated Skill");
    await user.type(search, "review");

    expect(await view.findByRole("option", { name: "review-round (project)" })).toBeDefined();
    expect(view.queryByRole("option", { name: "build-feature (project)" })).toBeNull();

    await user.click(view.getByRole("option", { name: "review-round (project)" }));
    expect(changes).toEqual(["skill-review"]);
  });

  test("shows a specific empty result without accepting free text", async () => {
    const changes: string[] = [];
    const user = userEvent.setup();
    const view = render(
      <SearchableSelectField
        label="Workflow Skill override"
        value=""
        options={[{ value: "skill-review", label: "review-round (project)" }]}
        onChange={(value) => changes.push(value)}
        emptyMessage="No matching Workflow Skills"
      />,
    );

    const search = view.getByRole("combobox", { name: "Workflow Skill override" });
    await user.type(search, "missing");
    expect(await view.findByText("No matching Workflow Skills")).toBeDefined();
    await user.keyboard("{Enter}");
    expect(changes).toEqual([]);
  });
});

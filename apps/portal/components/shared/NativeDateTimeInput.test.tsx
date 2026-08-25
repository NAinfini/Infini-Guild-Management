import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@portal/stores/preferences";
import { NativeDateTimeInput } from "./NativeDateTimeInput";

function renderInput(
  props: Partial<React.ComponentProps<typeof NativeDateTimeInput>> = {},
) {
  const changedValues: string[] = [];
  const onChange = vi.fn((event: React.ChangeEvent<HTMLInputElement>) => {
    changedValues.push(event.currentTarget.value);
  });
  const result = render(
    <NativeDateTimeInput
      aria-label="Date"
      value="2026-08-04"
      onChange={onChange}
      {...props}
    />,
  );

  return {
    ...result,
    input: result.container.querySelector("input") as HTMLInputElement,
    onChange,
    changedValues,
  };
}

describe("NativeDateTimeInput", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ locale: "en" });
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLInputElement.prototype, "showPicker");
  });

  it.each([
    ["en", "Aug 4, 2026"],
    ["zh", "2026年8月4日"],
  ] as const)("renders one native date input with a localized %s overlay", (locale, display) => {
    usePreferencesStore.setState({ locale });
    const { container, input } = renderInput();

    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(input).toHaveValue("2026-08-04");
    expect(input.tabIndex).toBe(0);
    expect(screen.getByText(display)).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the caller-provided localized placeholder when the date is empty", () => {
    const { input } = renderInput({
      value: "",
      placeholder: "Start date",
    });

    expect(input).toHaveValue("");
    expect(screen.getByText("Start date")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps ISO values and the native onChange contract", () => {
    const { input, onChange, changedValues } = renderInput();

    fireEvent.change(input, { target: { value: "2026-08-05" } });

    expect(changedValues).toEqual(["2026-08-05"]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("opens the picker from the visible date control", async () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      configurable: true,
      value: showPicker,
    });
    const { input } = renderInput();

    await userEvent.click(input);

    expect(showPicker).toHaveBeenCalledOnce();
  });

  it.each(["time", "datetime-local"] as const)(
    "keeps the %s path as one unoverlaid native input",
    (type) => {
      const value = type === "time" ? "09:30" : "2026-08-04T09:30";
      const { container, input } = renderInput({ type, value });

      expect(input).toHaveAttribute("type", type);
      expect(input).toHaveValue(value);
      expect(container.querySelector(".native-date-input__display")).toBeNull();
      expect(container.querySelectorAll("input")).toHaveLength(1);
    },
  );
});

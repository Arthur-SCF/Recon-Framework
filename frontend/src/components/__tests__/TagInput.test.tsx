import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagInput } from "../TagInput";

describe("TagInput", () => {
  it("adds a tag when Enter is pressed", async () => {
    const onChange = vi.fn();
    render(<TagInput tags={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "web{Enter}");
    expect(onChange).toHaveBeenCalledWith(["web"]);
  });

  it("adds a tag when comma is typed", async () => {
    const onChange = vi.fn();
    render(<TagInput tags={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "api,");
    expect(onChange).toHaveBeenCalledWith(["api"]);
  });

  it("renders existing tags as chips with # prefix", () => {
    render(<TagInput tags={["alpha", "beta"]} onChange={vi.fn()} />);
    // Chips render as "#alpha" and "#beta"
    expect(screen.getByText("#alpha", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("#beta", { exact: false })).toBeInTheDocument();
  });

  it("removes a tag when its × button is clicked", async () => {
    const onChange = vi.fn();
    render(<TagInput tags={["alpha", "beta"]} onChange={onChange} />);
    // Two × buttons — click the first one (removes "alpha")
    const removeButtons = screen.getAllByRole("button");
    await userEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(["beta"]);
  });

  it("hides input and does not call onChange when at max tags", async () => {
    const onChange = vi.fn();
    render(<TagInput tags={["a", "b", "c"]} onChange={onChange} max={3} />);
    // Input is hidden when tags.length >= max
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes the last tag on Backspace when input is empty", async () => {
    const onChange = vi.fn();
    render(<TagInput tags={["alpha", "beta"]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await userEvent.click(input);
    await userEvent.keyboard("{Backspace}");
    expect(onChange).toHaveBeenCalledWith(["alpha"]);
  });
});

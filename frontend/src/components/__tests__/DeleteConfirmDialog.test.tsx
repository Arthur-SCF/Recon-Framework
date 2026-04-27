import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteConfirmDialog } from "../DeleteConfirmDialog";

describe("DeleteConfirmDialog", () => {
  it("renders the item name in the dialog", () => {
    render(
      <DeleteConfirmDialog
        open
        onOpenChange={vi.fn()}
        itemName="example.com"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("calls onConfirm when the delete button is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmDialog
        open
        onOpenChange={vi.fn()}
        itemName="example.com"
        onConfirm={onConfirm}
      />,
    );
    // Button text is "Delete {itemType}" — default itemType is "item"
    await userEvent.click(screen.getByRole("button", { name: /delete item/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange(false) when the cancel button is clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <DeleteConfirmDialog
        open
        onOpenChange={onOpenChange}
        itemName="example.com"
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables buttons and shows 'Deleting…' when loading=true", () => {
    render(
      <DeleteConfirmDialog
        open
        onOpenChange={vi.fn()}
        itemName="example.com"
        onConfirm={vi.fn()}
        loading
      />,
    );
    // When loading, button text changes to "Deleting…" and it is disabled
    const deletingBtn = screen.getByRole("button", { name: /deleting/i });
    expect(deletingBtn).toBeDisabled();
    // Cancel is also disabled while loading
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });
});

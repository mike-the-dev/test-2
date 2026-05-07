import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BudgetSplash } from "@/components/budget-splash";
import type { SplashConfigOnboardingFieldBudget } from "@/types/chat";

// The Affirm SDK loader touches window globals; stub it so tests stay hermetic.
vi.mock("@/lib/affirm", () => ({
  loadAffirmSdk: vi.fn(),
  refreshAffirmUi: vi.fn(),
}));

describe("BudgetSplash", () => {
  const budgetField: SplashConfigOnboardingFieldBudget = {
    kind: "budget",
    key: "budgetCents",
    label: "What's your budget?",
    required: true,
  };

  it("seeds the input with a $1,000 default and enables Start chat immediately", () => {
    const onSubmit = vi.fn();
    render(<BudgetSplash field={budgetField} onSubmit={onSubmit} />);

    expect(screen.getByLabelText(/budget amount/i)).toHaveValue("1000");
    expect(screen.getByRole("button", { name: /start chat/i })).toBeEnabled();
  });

  it("disables the Start chat button when the amount dips below $50", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<BudgetSplash field={budgetField} onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/budget amount/i);
    const button = screen.getByRole("button", { name: /start chat/i });

    await user.clear(input);
    await user.type(input, "49");
    expect(button).toBeDisabled();

    await user.clear(input);
    await user.type(input, "50");
    expect(button).toBeEnabled();
  });

  it("forwards the validated dollar amount to onSubmit when submitted", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<BudgetSplash field={budgetField} onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/budget amount/i);
    await user.clear(input);
    await user.type(input, "500");
    await user.click(screen.getByRole("button", { name: /start chat/i }));

    expect(onSubmit).toHaveBeenCalledWith({ budgetCents: 50_000 });
  });

  it("does not call onSubmit when the form is submitted below the minimum", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<BudgetSplash field={budgetField} onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/budget amount/i);
    await user.clear(input);
    await user.type(input, "10");
    // Button is disabled so submit via Enter — the handler still short-circuits.
    await user.keyboard("{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("swaps the Affirm/payment block for a nudge note when the amount exceeds $30,000", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<BudgetSplash field={budgetField} onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/budget amount/i);

    // At the default $1,000 we see the payment estimates block.
    expect(await screen.findByTestId("payment-estimates")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "50000");

    // Debounced updates eventually reveal the large-budget nudge and hide
    // the payment cards + Affirm element.
    expect(await screen.findByTestId("large-budget-note")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-estimates")).toBeNull();
    expect(screen.queryByTestId("affirm-slot")).toBeNull();

    // Start chat remains enabled — the agent handles larger amounts.
    expect(screen.getByRole("button", { name: /start chat/i })).toBeEnabled();
  });

  it("renders field.label as the question text", () => {
    const onSubmit = vi.fn();
    const customField: SplashConfigOnboardingFieldBudget = {
      ...budgetField,
      label: "What's your renovation budget?",
    };
    render(<BudgetSplash field={customField} onSubmit={onSubmit} />);

    expect(screen.getByText("What's your renovation budget?")).toBeInTheDocument();
  });

  it("renders the submitError message above the submit button when provided", () => {
    const onSubmit = vi.fn();
    render(
      <BudgetSplash
        field={budgetField}
        onSubmit={onSubmit}
        submitError="Too small: expected number to be >0"
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Too small: expected number to be >0");
  });

  it("enables the submit button on empty input when field.required is false and submits with {}", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const optionalField: SplashConfigOnboardingFieldBudget = {
      ...budgetField,
      required: false,
    };
    render(<BudgetSplash field={optionalField} onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/budget amount/i);
    await user.clear(input);

    const button = screen.getByRole("button", { name: /start chat/i });
    expect(button).toBeEnabled();

    await user.click(button);

    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it("uses field.key when building the submission payload", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<BudgetSplash field={budgetField} onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/budget amount/i);
    await user.clear(input);
    await user.type(input, "500");
    await user.click(screen.getByRole("button", { name: /start chat/i }));

    expect(onSubmit).toHaveBeenCalledWith({ budgetCents: 50_000 });
  });
});

// Branch B — research currency constants. TBD-playtesting placeholder values, named per
// project convention (do not invent balance numbers, use clearly-named placeholders).

export const RESEARCH_CONCURRENCY_COST_STEP = 0.25; // +25% cost per additional simultaneous
                                                      // project, uncapped — a soft cap via
                                                      // rising price, never a hard slot limit
export const RESEARCH_CANCEL_REFUND_RATE = 0.5;       // fraction of invested currency refunded
                                                       // on cancel; remainder is forfeited
export const URANIUM_INJECTION_SCIENCE_AMOUNT = 50;   // one-time science boost on completing
                                                       // the Uranium research-currency node,
                                                       // granted only with nonzero uranium stock

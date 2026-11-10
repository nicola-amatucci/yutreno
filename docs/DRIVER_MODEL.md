# A model of a human driver

The two ATOs of YuTreno drive the same way every time and never make a mistake. `examples/driver_model.js` is a driver that does not: every seed gives a slightly different driver, who responds late to an overspeed, rides at a margin of its own below the permitted speed and uses a share of the traction and of the brake that depends on its style. With it one can compare styles of driving with the ATO with everything else equal, see how the onboard protection catches the slack of a person, and, in teaching, compare a student's driving with that of a model.

The model starts from the one of Barbaro et al. (2026, §3.2.3), built at the Politecnico di Milano for their fixed and moving block simulator. It is an ordinary controller ([API.md](API.md)): it does not touch the core, and it runs in the page, headless and in the campaigns.

## The model

The driver looks at the speed of the train and at two curves of its own.

- **The low curve** lies below the permitted speed by a margin. The margin is drawn once, at the start of the run, from a Gaussian with a mean and a standard deviation of the profile, and is never negative. Below the low curve the driver applies traction.
- **The upper curve** is the permitted speed. Above it the driver brakes, but not at once: in every control step it responds with probability 1 − exp(−λ·Δt), where the rate λ = λ₀ + g·τ starts from a base value λ₀ and grows by g for every second τ spent above the curve. Until it responds the previous command stays. Once it has responded it brakes until the speed is back at the permitted speed.
- **Between the two curves** it coasts.
- **The style** is given by two utilisation coefficients that scale the traction and the brake: the driver commands traction k_T and brake k_B, not the full value.
- **Towards an end of authority or a signal at danger** the driver brakes to a stop when it is closer than a minimum distance. Until then the curves do the work, because the permitted speed comes down towards the target.

Vigilance, doors and station stops are those of `examples/ato.js`: the driver acknowledges the vigilance at once, keeps the brake while the doors are open, and within 600 m of a stop marker uses the stopping curve and the regulator of the ATO. A comparison with the ATO therefore measures only the style of driving between the stations.

### Where it differs from the model of Milan

- **The upper curve.** In the model of Milan the driver brakes above the warning curve. In YuTreno the warning curve of ETCS lies only a few km/h above the permitted speed, and the service brake intervention curve follows close behind it. Braking only above the warning curve, with any response time, the medium driver got a service brake intervention up to five times per run on the worksite scenario, which is not how a trained driver behaves. By default the driver therefore brakes above the permitted speed, the overspeed the DMI shows. `brake_above: "warning"` gives the rule of Milan.
- **Braking back to the permitted speed.** In the model of Milan the driver stops braking as soon as the speed is under the upper curve. Here it keeps braking until it is back at the permitted speed, otherwise brake and coast would alternate at every step around the curve.
- **The response as a rate.** The text of Milan describes a probability that starts from a base value and grows with time. Here it is a rate per second, so the distribution of the response time does not depend on the control period.

## Parameters

The values of the article of Milan are not given in its text (its Table 1 cannot be read in the open version), so the values here are chosen and declared.

| Parameter | Cautious | Medium | Aggressive | Meaning |
| :-- | :-- | :-- | :-- | :-- |
| `margin_mean_kmh` | 10 | 5 | 2 | mean margin of the low curve below the permitted speed |
| `margin_sd_kmh` | 2.0 | 1.5 | 1.0 | its standard deviation |
| `k_traction` | 0.6 | 0.8 | 1.0 | share of the traction used |
| `k_brake` | 0.8 | 0.8 | 1.0 | share of the service brake used |
| `eoa_distance_m` | 150 | 100 | 60 | distance from an end of authority at which the driver brakes to a stop |
| `response_base_per_s` | 0.3 | 0.3 | 0.3 | base rate of the response, λ₀ (1/s) |
| `response_growth_per_s2` | 0.3 | 0.3 | 0.3 | growth of the rate, g (1/s²) |
| `brake_above` | permitted | permitted | permitted | upper curve: `permitted` or `warning` |

Why these values:

- **The response is the same for the three profiles**, because in the model of Milan the style comes from the margin and the two coefficients, and keeping the response apart lets one study it on its own. With λ₀ = 0.3/s and g = 0.3/s² the mean response time is 1.5 s, and 2.7 % of the responses take longer than 4 s. Four seconds is the driver reaction time T_driver that the ETCS curves leave between the permitted speed and the service brake intervention (the national value of the reference onboard), so a medium driver rarely lets the protection brake for it.
- **The margins** go from 10 km/h, a driver who keeps well clear of the permitted speed, to 2 km/h, one who rides close to it. The standard deviations keep the margins of different seeds apart without making them negative.
- **The coefficients.** The cautious driver uses less traction but brakes as firmly as the medium one: a weak brake would make it the driver most often caught by the protection, because the permitted speed comes down towards a target at the service deceleration and a driver who brakes at half of it falls behind. The aggressive driver uses the full traction and the full brake.
- **The distance from the end of authority** grows with caution, from 60 to 150 m.

Every parameter can be overridden one by one.

## How to run it

```bash
npm run headless -- --scenario scenarios/radio-loss.json --controller examples/driver_model.js --controller-params '{"profile":"aggressive","seed":2}'
npm run driver-campaign                      # campaigns/drivers.json, output in results/driver-campaign-drivers/
```

`--controller-params` gives a JSON object to the controller as the global variable `PARAMS`: `profile`, `seed` and any parameter of the table. Without it the driver is `medium` with seed 1, which is what the page uses. The randomness comes from a small seeded generator written in the example (mulberry32), not from `Math.random`: two runs with the same seed are identical byte for byte, in Node and in the browser.

## Checks

`verify-ato` checks the model in two tests.

- **DRV1.** On Valle Lauro, every profile with seed 1 twice gives the same run, with seed 2 a different one, and the three profiles give three different runs.
- **DRV2.** An ideal driver (immediate response, no spread of the margin) on the Appennino pass and on Valle Lauro never comes closer than 4 km/h to the warning curve and gets no warning, no service brake and no intervention. A slow driver (λ₀ = 0.02/s, g = 0.005/s², a mean response of several seconds) gets warnings and service brakings from the protection on both lines, and on Valle Lauro an intervention.

## The driver campaign

`npm run driver-campaign` runs the three profiles with five seeds each and the ATO of `examples/ato.js` once, with the internal supervision and with the reference onboard, on the six ETCS scenarios of the reference campaign as written, faults included: 192 runs in about 8 minutes. It is a campaign of its own, so the reference campaign keeps its fingerprint. `runs.csv` has one row per run with its fingerprint, `summary.csv` the mean and the standard deviation over scenarios and seeds, `determinism.csv` the same seed repeated and another seed.

Means over the six scenarios and the five seeds (the ATO drives each scenario once):

| Driver | Onboard | Passed | Time | Net energy | Warnings | Service brakings | Interventions | Held by the signalling |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| ATO | internal | 4/6 | 1195 s | 141.4 kWh | 0.5 | 0.0 | 0.0 | 452 s |
| cautious | internal | 17/30 | 1208 s | 133.0 kWh | 3.2 | 0.7 | 0.5 | 348 s |
| medium | internal | 20/30 | 1187 s | 148.0 kWh | 3.9 | 0.7 | 0.3 | 413 s |
| aggressive | internal | 20/30 | 1179 s | 167.5 kWh | 5.1 | 0.9 | 0.3 | 458 s |
| ATO | reference | 4/6 | 1188 s | 165.0 kWh | 0.8 | 0.3 | 0.3 | 386 s |
| cautious | reference | 13/30 | 1206 s | 146.4 kWh | 6.1 | 3.0 | 0.7 | 302 s |
| medium | reference | 20/30 | 1190 s | 165.4 kWh | 7.1 | 3.7 | 0.5 | 363 s |
| aggressive | reference | 20/30 | 1183 s | 190.1 kWh | 7.0 | 1.7 | 0.5 | 403 s |

What the campaign shows:

- **The style moves energy far more than time.** From cautious to aggressive the net energy grows by 26 % with the internal supervision and by 30 % with the reference onboard, while the time over the run falls by about 2 %, because most of the run is spent behind the freight train ahead or at the stations. The ATO uses less energy than the medium driver with the internal supervision and as much with the reference onboard, and takes about as long as the medium driver.
- **The reference onboard catches the people more often.** With the internal supervision a human driver gets a service brake intervention less than once per run; with the reference onboard three to four times for the cautious and the medium driver. The curves of §3.13 put the service brake intervention 4 s of running beyond the permitted speed, and a driver who responds in about 1.5 s and then waits for the pneumatic brake to build up uses most of that margin; the internal supervision puts it further away. The ATO, which never goes over the permitted speed, is hardly touched by either.
- **The hidden faults are where the protection intervenes.** The degraded brake and the leaves make every driver fail, the ATO included, as in the reference campaign; with the degraded brake the human drivers get two or three interventions per run and the ATO with the internal supervision none: the human brakes only once over the permitted speed, and with less brake than it expects it cannot get back under the curves in time.
- **The cautious driver fails on time.** It passes fewer scenarios than the others, most of all the worksite speed restriction (2 and 1 of 5), because it arrives later than the scenario allows; it is the slowest but not the safest driver, since with the reference onboard it gets nearly as many service brakings as the medium one.
- **The time held by the signalling depends on the driver.** The aggressive driver catches up with the freight train ahead and waits behind it longer than the cautious one (458 against 348 s with the internal supervision), so the measure of [CAPACITY.md](CAPACITY.md#time-held-by-the-signalling) describes the protection seen by one driver, not a property of the line alone.

These numbers depend on the declared parameters, which are not calibrated on real drivers: they are an example of what the model can show, not a result about drivers.

## What the model does not do

- **It is not calibrated on real drivers.** The parameters are declared assumptions; no data of real drivers were used.
- **One draw per run.** The margin of the low curve is drawn once; there is no fatigue, no distraction that comes and goes, no change of style along the run.
- **The rest is perfect.** The driver acknowledges the vigilance at once, reads the DMI without delay and stops at the stations like the ATO.

## Sources

- E. Barbaro, I. La Paglia, F. Bernardini, G. Bucca, R. Corradi, M. Bocciolone, A. Collina, *A modular simulation tool for fixed block and moving block railway signalling systems*, Railway Engineering Science 34(2), 2026, pp. 257–274, §3.2.3.
- ERA, Subset-026 v4.0.0, §3.13.9.3 (the permitted speed and the service brake intervention, separated by T_driver).
- T. Ettinger, mulberry32, a 32-bit pseudorandom generator.

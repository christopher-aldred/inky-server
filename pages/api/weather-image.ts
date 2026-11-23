import type { NextApiRequest, NextApiResponse } from "next";
import { getAuroraAlert } from "../../utils/aurora";
import { getWeatherDetails } from "../../utils/weather";
import { buildScreenModel } from "../../utils/weather-screen/model";
import { renderWeatherScreen } from "../../utils/weather-screen/render";
import { getWeatherWarning } from "../../utils/weather-warnings";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	try {
		const location = (req.query.location as string) || "London,UK";

		// Alert sources never throw; a failure just means no banner.
		const [weather, warning, aurora] = await Promise.all([
			getWeatherDetails(location),
			getWeatherWarning(),
			getAuroraAlert(),
		]);

		const model = buildScreenModel(weather, {
			location,
			now: Math.floor(Date.now() / 1000),
			warning,
			aurora,
		});
		const image = await renderWeatherScreen(model);

		res.setHeader("Content-Type", "image/jpeg");
		res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");
		res.send(image);
	} catch (error) {
		console.error("Error:", error);
		res.status(500).json({ error: "Failed to generate weather image" });
	}
}

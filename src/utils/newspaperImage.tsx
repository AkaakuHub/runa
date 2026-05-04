import sharp from "sharp";
import {
	HtmlImageDocument,
	renderReactHtmlToPng,
	useHtmlImageDocument,
} from "../hooks/useHtmlImageRenderer";

const paperWidth = 1500;
const paperHeight = 2100;

export interface NewspaperPhoto {
	url: string;
	caption: string;
	timestamp: Date;
	messageUrl: string;
}

interface NewsTopic {
	title: string;
	time: string;
	url: string;
	body: string;
}

interface ParsedDailySummary {
	label: string;
	score: string;
	reasons: string[];
	topics: NewsTopic[];
	tomorrow: string;
}

interface MatchedPhoto {
	dataUri: string;
	caption: string;
	messageUrl: string;
	timestamp: Date;
}

interface ArticleView {
	topic: NewsTopic;
	photo: MatchedPhoto | null;
	titleClass: string;
	bodyClass: string;
	photoClass: string;
}

interface NewspaperDocumentProps {
	parsed: ParsedDailySummary;
	dateLabel: string;
	photos: MatchedPhoto[];
}

function buildLunaemonQuestion(parsed: ParsedDailySummary): {
	question: string;
	answer: string;
} {
	const topic = parsed.topics[1] ?? parsed.topics[0];
	const subject =
		topic?.title.replace(/[、。！？?!]/g, "").slice(0, 14) || "今日";
	return {
		question: `${subject}、どう見る？`,
		answer:
			parsed.tomorrow ||
			"ログは急がず読むのが吉。強い言葉の裏に、小さな本題が隠れている。",
	};
}

function normalizeJapaneseText(text: string): string {
	return text
		.replace(/[ \t\r\n]+/g, "")
		.replace(/([A-Za-z0-9])([一-龯ぁ-んァ-ヶ々〆〤])/g, "$1 $2")
		.replace(/([一-龯ぁ-んァ-ヶ々〆〤])([A-Za-z0-9])/g, "$1 $2")
		.replace(/\s+([、。，．・：；？！）」』】])/g, "$1")
		.replace(/([「『【（])\s+/g, "$1")
		.trim();
}

function normalizeHeadline(text: string): string {
	return text.replace(/[ \t\r\n]+/g, " ").trim();
}

function parseDailySummary(summary: string): ParsedDailySummary {
	const judgmentMatch = summary.match(
		/###\s*今日は『([^』]+)』の日でした！\((\d+)%\)/,
	);
	const label = judgmentMatch?.[1] ?? "ケ";
	const score = judgmentMatch?.[2] ?? "50";
	const reasons = Array.from(
		summary.matchAll(/│\s*[^:：]+[:：]\s*([^│]+?)\s*│/g),
	)
		.map((match) => normalizeJapaneseText(match[1]))
		.filter(Boolean)
		.slice(0, 5);
	const topics: NewsTopic[] = [];
	const topicRegex =
		/🔸 \*\*(.+?)\*\* - (\d{2}:\d{2})\n(https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+)\n([\s\S]*?)(?=\n\n🔸 \*\*|\n\n🔮 \*\*明日への一言\*\*|$)/g;

	for (const match of summary.matchAll(topicRegex)) {
		topics.push({
			title: normalizeHeadline(match[1]),
			time: match[2].trim(),
			url: match[3].trim(),
			body: normalizeJapaneseText(match[4]),
		});
	}

	const tomorrowMatch = summary.match(/🔮 \*\*明日への一言\*\*\n([\s\S]+)$/);

	return {
		label,
		score,
		reasons,
		topics,
		tomorrow: normalizeJapaneseText(tomorrowMatch?.[1] ?? ""),
	};
}

async function fetchPhotoDataUri(
	photo: NewspaperPhoto,
): Promise<string | null> {
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), 5000);
	try {
		const response = await fetch(photo.url, { signal: abortController.signal });
		if (!response.ok) return null;

		const inputBuffer = Buffer.from(await response.arrayBuffer());
		const buffer = await sharp(inputBuffer)
			.resize(900, 620, { fit: "cover" })
			.grayscale()
			.jpeg({ quality: 84 })
			.toBuffer();

		return `data:image/jpeg;base64,${buffer.toString("base64")}`;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

async function buildPhotoSlots(
	photos: NewspaperPhoto[],
): Promise<MatchedPhoto[]> {
	const slots: MatchedPhoto[] = [];
	for (const photo of photos) {
		const dataUri = await fetchPhotoDataUri(photo);
		if (!dataUri) continue;
		slots.push({
			dataUri,
			caption: normalizeHeadline(photo.caption),
			messageUrl: photo.messageUrl,
			timestamp: photo.timestamp,
		});
	}

	return slots;
}

function findTopicPhoto(
	topic: NewsTopic | undefined,
	photos: MatchedPhoto[],
	used: Set<string>,
): MatchedPhoto | null {
	if (!topic) return null;
	const exactPhoto = photos.find(
		(photo) => photo.messageUrl === topic.url && !used.has(photo.messageUrl),
	);
	if (exactPhoto) {
		used.add(exactPhoto.messageUrl);
		return exactPhoto;
	}
	return null;
}

function classifyTitle(title: string): string {
	const chars = Array.from(title).length;
	if (chars <= 12) return "title-xl";
	if (chars <= 16) return "title-lg";
	if (chars <= 20) return "title-md";
	if (chars <= 26) return "title-sm";
	return "title-xs";
}

function classifyBody(body: string, hasPhoto: boolean): string {
	const chars = Array.from(body).length;
	if (hasPhoto) {
		if (chars >= 70) return "body-photo-dense";
		if (chars >= 52) return "body-photo";
		return "body-photo-short";
	}
	if (chars >= 80) return "body-dense";
	if (chars <= 52) return "body-short";
	return "body-regular";
}

function classifyPhoto(body: string): string {
	const chars = Array.from(body).length;
	if (chars >= 75) return "photo-regular";
	if (chars <= 52) return "photo-large";
	return "photo-regular";
}

function buildArticles(
	parsed: ParsedDailySummary,
	photos: MatchedPhoto[],
): ArticleView[] {
	const usedPhotos = new Set<string>();
	return parsed.topics.slice(1, 7).map((topic) => {
		const photo = findTopicPhoto(topic, photos, usedPhotos);
		return {
			topic,
			photo,
			titleClass: classifyTitle(topic.title),
			bodyClass: classifyBody(topic.body, Boolean(photo)),
			photoClass: classifyPhoto(topic.body),
		};
	});
}

function PhotoFigure({
	photo,
	className = "",
}: {
	photo: MatchedPhoto | null;
	className?: string;
}) {
	if (!photo) return null;
	return (
		<figure className={`photo ${className}`}>
			<img src={photo.dataUri} alt="" />
			<figcaption>{photo.caption}</figcaption>
		</figure>
	);
}

function StoryArticle({ article }: { article: ArticleView }) {
	const { topic, photo, titleClass, bodyClass, photoClass } = article;
	return (
		<article className={`story ${photo ? `has-photo has-${photoClass}` : ""}`}>
			<div className="story-time">{topic.time}</div>
			<h2 className={`story-title ${titleClass}`}>{topic.title}</h2>
			<p className={`story-body ${bodyClass}`}>{topic.body}</p>
			<PhotoFigure photo={photo} className={photoClass} />
		</article>
	);
}

function EmptyStoryBox({ index }: { index: number }) {
	return (
		<aside className="story empty-story">
			<div className="story-time">--:--</div>
			<h2 className="story-title title-lg">紙面待機</h2>
			<p className="story-body body-short">
				記事数が不足しました。プロンプトの出力本数を確認してください。
			</p>
			<span className="empty-index">{index}</span>
		</aside>
	);
}

const newspaperCss = `
body {
	color: #111;
	font-family: "Noto Serif CJK JP", "Yu Mincho", "Hiragino Mincho ProN", serif;
	-webkit-font-smoothing: antialiased;
}
.paper {
	position: relative;
	width: ${paperWidth}px;
	height: ${paperHeight}px;
	padding: 42px;
	border: 5px solid #111;
	background:
		radial-gradient(circle at 18% 12%, rgba(255,255,255,0.3), transparent 28%),
		linear-gradient(135deg, #f7f0df 0%, #f5f1e7 58%, #ece5d5 100%);
	overflow: hidden;
}
.paper::after {
	content: "";
	position: absolute;
	inset: 0;
	pointer-events: none;
	opacity: 0.08;
	background-image:
		linear-gradient(0deg, rgba(0,0,0,0.18) 1px, transparent 1px),
		linear-gradient(90deg, rgba(0,0,0,0.12) 1px, transparent 1px);
	background-size: 5px 5px, 7px 7px;
	mix-blend-mode: multiply;
}
.layout {
	position: relative;
	z-index: 1;
	display: grid;
	grid-template-columns: 1fr 210px;
	gap: 24px;
	width: 100%;
	height: 100%;
}
.content {
	display: grid;
	grid-template-rows: 118px 18px 390px 16px 1fr 28px;
	gap: 16px;
	min-width: 0;
}
.headline {
	display: flex;
	align-items: center;
	padding: 0 24px;
	background: #111;
	color: #fff;
	font-size: 50px;
	font-weight: 900;
	line-height: 1.05;
	letter-spacing: 0;
	white-space: normal;
	overflow: hidden;
}
.double-rule {
	border-top: 4px solid #111;
	border-bottom: 1.5px solid #111;
}
.main {
	display: grid;
	grid-template-columns: minmax(500px, 0.9fr) 1fr;
	gap: 28px;
	min-height: 0;
}
.main-copy {
	position: relative;
	display: grid;
	grid-template-columns: 1fr 42px;
	gap: 10px;
	min-width: 0;
}
.main-body,
.story-body,
.mast-reasons,
.tomorrow .story-body {
	writing-mode: vertical-rl;
	text-orientation: mixed;
	line-break: strict;
	overflow-wrap: anywhere;
	word-break: normal;
	letter-spacing: 0;
}
.main-body {
	justify-self: end;
	width: 100%;
	height: 390px;
	font-size: 28px;
	font-weight: 700;
	line-height: 1.34;
	margin: 0;
	overflow: hidden;
}
.main-time {
	align-self: end;
	font-family: "Noto Sans CJK JP", sans-serif;
	font-size: 18px;
	font-weight: 800;
}
.photo {
	position: relative;
	margin: 0;
	background: #191512;
	border: 3px solid #16110e;
	overflow: hidden;
}
.main .photo {
	width: 100%;
	height: 390px;
}
.photo img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
	filter: grayscale(1) contrast(1.08);
}
.photo figcaption {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	padding: 8px 12px 9px;
	background: rgba(0,0,0,0.72);
	color: #f8f1df;
	font-family: "Noto Sans CJK JP", sans-serif;
	font-size: 18px;
	line-height: 1.15;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.photo-placeholder {
	display: grid;
	place-items: center;
	width: 100%;
	height: 390px;
	border: 3px solid #16110e;
	background: #d5c5a6;
	color: #514736;
	font-size: 34px;
	font-weight: 900;
}
.stories {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	grid-template-rows: repeat(3, minmax(0, 1fr));
	gap: 10px;
	min-height: 0;
}
.story {
	position: relative;
	display: block;
	min-height: 0;
	min-width: 0;
	padding: 46px 18px 18px;
	border: 2px solid #111;
	background: rgba(255,255,255,0.14);
	overflow: hidden;
}
.story-time {
	position: absolute;
	top: 16px;
	right: 18px;
	font-family: "Noto Sans CJK JP", sans-serif;
	font-size: 18px;
	font-weight: 900;
}
.story-title {
	position: absolute;
	top: 44px;
	right: 18px;
	bottom: 18px;
	width: 178px;
	writing-mode: vertical-rl;
	text-orientation: mixed;
	line-break: strict;
	margin: 0;
	font-weight: 900;
	line-height: 1.05;
	overflow: hidden;
}
.title-xl { font-size: 54px; }
.title-lg { font-size: 46px; }
.title-md { font-size: 38px; line-height: 1.06; }
.title-sm { font-size: 31px; line-height: 1.08; }
.title-xs { font-size: 26px; line-height: 1.1; }
.story-body {
	position: absolute;
	top: 44px;
	right: 214px;
	bottom: 18px;
	left: 22px;
	margin: 0;
	font-size: 20px;
	line-height: 1.36;
	overflow: hidden;
}
.body-short { font-size: 36px; line-height: 1.38; }
.body-regular { font-size: 32px; }
.body-dense { font-size: 27px; line-height: 1.26; }
.body-photo-short { font-size: 29px; line-height: 1.26; }
.body-photo { font-size: 25px; line-height: 1.2; }
.body-photo-dense { font-size: 21px; line-height: 1.13; }
.story .photo {
	position: absolute;
	left: 22px;
	bottom: 24px;
	width: 360px;
	height: 180px;
}
.story.has-photo .story-body {
	bottom: 214px;
}
.story.has-photo.has-photo-small .story-body { bottom: 190px; }
.story.has-photo.has-photo-large .story-body { bottom: 228px; }
.story .photo-small { width: 320px; height: 156px; }
.story .photo-large { width: 390px; height: 194px; }
.story .photo figcaption {
	font-size: 16px;
	padding: 7px 10px;
}
.tomorrow {
	background: rgba(255,255,255,0.26);
}
.empty-story {
	background: rgba(255,255,255,0.18);
}
.empty-index {
	position: absolute;
	left: 18px;
	bottom: 14px;
	font-family: "Noto Sans CJK JP", sans-serif;
	font-size: 14px;
	color: #8a8173;
}
.footer {
	display: flex;
	align-items: end;
	justify-content: space-between;
	color: #5f5548;
	font-family: "Noto Sans CJK JP", sans-serif;
	font-size: 15px;
	white-space: nowrap;
	overflow: hidden;
}
.masthead {
	position: relative;
	display: grid;
	grid-template-rows: 372px 1fr 80px;
	border: 2px solid #111;
	background: rgba(250,246,234,0.72);
	min-width: 0;
}
.mast-title {
	position: absolute;
	top: 36px;
	right: 24px;
	writing-mode: vertical-rl;
	font-size: 58px;
	font-weight: 900;
	line-height: 1;
}
.mast-roman {
	position: absolute;
	top: 44px;
	left: 42px;
	writing-mode: vertical-rl;
	font-family: "Noto Sans CJK JP", sans-serif;
	font-size: 18px;
	font-weight: 800;
	color: #555;
}
.mast-info {
	grid-row: 2;
	display: grid;
	align-content: start;
	justify-items: center;
	gap: 18px;
	border-top: 3px solid #111;
	margin: 0 12px;
	padding-top: 28px;
	font-family: "Noto Sans CJK JP", sans-serif;
}
.date {
	font-size: 18px;
	font-weight: 800;
	white-space: nowrap;
}
.score {
	font-size: 29px;
	font-weight: 900;
}
.edition {
	font-size: 22px;
	font-weight: 900;
}
.side-corners {
	width: 100%;
	display: grid;
	grid-template-rows: 250px 310px;
	gap: 18px;
	margin-top: 8px;
}
.side-corner {
	position: relative;
	border-top: 2px solid #111;
	padding-top: 0;
	overflow: hidden;
}
.corner-title {
	position: absolute;
	top: 12px;
	left: 0;
	right: 0;
	height: 28px;
	writing-mode: horizontal-tb;
	font-family: "Noto Sans CJK JP", sans-serif;
	font-size: 18px;
	font-weight: 900;
	line-height: 1;
	letter-spacing: 0;
	text-align: center;
	margin: 0;
	white-space: nowrap;
	overflow: hidden;
}
.corner-body {
	position: absolute;
	top: 50px;
	right: 8px;
	bottom: 0;
	left: 8px;
	margin: 0;
	writing-mode: vertical-rl;
	text-orientation: mixed;
	line-break: strict;
	overflow-wrap: anywhere;
	font-family: "Noto Sans CJK JP", sans-serif;
	font-size: 18px;
	line-height: 1.35;
	overflow: hidden;
}
.corner-question {
	font-weight: 800;
	text-combine-upright: all;
}
.discord {
	grid-row: 4;
	align-self: center;
	justify-self: center;
	font-family: "Noto Sans CJK JP", sans-serif;
	font-size: 18px;
	font-weight: 900;
}
`;

function NewspaperDocument({
	parsed,
	dateLabel,
	photos,
}: NewspaperDocumentProps) {
	const document = useHtmlImageDocument({
		width: paperWidth,
		height: paperHeight,
		background: "#efe8d8",
		css: newspaperCss,
	});
	const usedPhotos = new Set<string>();
	const mainTopic = parsed.topics[0];
	const mainPhoto = findTopicPhoto(mainTopic, photos, usedPhotos);
	const headline = mainTopic?.title ?? "静かな一日、余白を残す";
	const mainBody =
		mainTopic?.body ?? "今日は大きな動きは少なく、静かな一日だった。";
	const lunaemon = buildLunaemonQuestion(parsed);
	const articles = buildArticles(
		parsed,
		photos.filter((photo) => !usedPhotos.has(photo.messageUrl)),
	);
	const storySlots = articles.map((article) => (
		<StoryArticle key={article.topic.url} article={article} />
	));

	while (storySlots.length < 6) {
		storySlots.push(
			<EmptyStoryBox
				key={`empty-${storySlots.length}`}
				index={storySlots.length + 1}
			/>,
		);
	}

	return (
		<HtmlImageDocument document={document}>
			<div className="paper">
				<div className="layout">
					<main className="content">
						<header className="headline">{headline}</header>
						<div className="double-rule" />
						<section className="main">
							{mainPhoto ? (
								<PhotoFigure photo={mainPhoto} />
							) : (
								<div className="photo-placeholder">写真なし</div>
							)}
							<div className="main-copy">
								<p className="main-body">{mainBody}</p>
							</div>
						</section>
						<div className="double-rule" />
						<section className="stories">{storySlots}</section>
						<footer className="footer">
							<span>
								{parsed.reasons.join(" / ") || "紙面は会話量と温度で判定"}
							</span>
							<strong>RUNA SERVER TIMES</strong>
						</footer>
					</main>
					<aside className="masthead">
						<div className="mast-title">瑠奈日報</div>
						<div className="mast-roman">RUNA SERVER TIMES</div>
						<div className="mast-info">
							<div className="date">{dateLabel}</div>
							<div className="score">
								{parsed.label} {parsed.score}%
							</div>
							<div className="edition">一面</div>
							<div className="side-corners">
								<section className="side-corner">
									<h3 className="corner-title">今日の筋</h3>
									<p className="corner-body">{parsed.reasons.join("　")}</p>
								</section>
								<section className="side-corner">
									<h3 className="corner-title">しつもんルナえもん</h3>
									<p className="corner-body">
										Q. {lunaemon.question}
										<br />
										A. {lunaemon.answer}
									</p>
								</section>
							</div>
						</div>
						<div className="discord">Discord版</div>
					</aside>
				</div>
			</div>
		</HtmlImageDocument>
	);
}

export async function generateDailyNewspaperImage(
	summary: string,
	dateLabel: string,
	photos: NewspaperPhoto[] = [],
): Promise<Buffer> {
	const parsed = parseDailySummary(summary);
	const photoSlots = await buildPhotoSlots(photos);
	return renderReactHtmlToPng(
		<NewspaperDocument
			parsed={parsed}
			dateLabel={dateLabel}
			photos={photoSlots}
		/>,
		{
			width: paperWidth,
			height: paperHeight,
			debugLabel: "newspaper",
		},
	);
}

/// <reference types="svelte" />

import {
	App,
	CachedMetadata,
	debounce,
	getAllTags,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	ItemView,
	WorkspaceLeaf,
	TFolder,
	Menu,
	Notice,
} from "obsidian";

import TagFolderViewComponent from "./TagFolderViewComponent.svelte";

import {
	SUBTREE_MARK,
	SUBTREE_MARK_REGEX,
	TagFolderItem,
	TreeItem,
	ViewItem,
} from "types";
import { treeRoot, currentFile, maxDepth } from "store";

type DISPLAY_METHOD = "PATH/NAME" | "NAME" | "NAME : PATH";

type HIDE_ITEMS_TYPE = "NONE" | "DEDICATED_INTERMIDIATES" | "ALL_EXCEPT_BOTTOM";

const HideItemsType: Record<string, string> = {
	NONE: "Hide nothing",
	DEDICATED_INTERMIDIATES: "Only intermediates of nested tags",
	ALL_EXCEPT_BOTTOM: "All intermediates",
};

interface TagFolderSettings {
	displayMethod: DISPLAY_METHOD;
	alwaysOpen: boolean;
	ignoreDocTags: string;
	ignoreTags: string;
	ignoreFolders: string;
	hideOnRootTags: string;
	sortType:
	| "DISPNAME_ASC"
	| "DISPNAME_DESC"
	| "NAME_ASC"
	| "NAME_DESC"
	| "MTIME_ASC"
	| "MTIME_DESC"
	| "CTIME_ASC"
	| "CTIME_DESC"
	| "FULLPATH_ASC"
	| "FULLPATH_DESC";
	sortTypeTag: "NAME_ASC" | "NAME_DESC" | "ITEMS_ASC" | "ITEMS_DESC";
	expandLimit: number;
	disableNestedTags: boolean;

	hideItems: HIDE_ITEMS_TYPE;
	scanDelay: number;
	useTitle: boolean;
	reduceNestedParent: boolean;
}

const DEFAULT_SETTINGS: TagFolderSettings = {
	displayMethod: "NAME",
	alwaysOpen: false,
	ignoreDocTags: "",
	ignoreTags: "",
	hideOnRootTags: "",
	sortType: "DISPNAME_ASC",
	sortTypeTag: "NAME_ASC",
	expandLimit: 0,
	disableNestedTags: false,
	hideItems: "NONE",
	ignoreFolders: "",
	scanDelay: 250,
	useTitle: true,
	reduceNestedParent: true,
};

const VIEW_TYPE_TAGFOLDER = "tagfolder-view";

const OrderKeyTag: Record<string, string> = {
	NAME: "File name",
	ITEMS: "Count of items",
};
const OrderDirection: Record<string, string> = {
	ASC: "Ascending",
	DESC: "Descending",
};
const OrderKeyItem: Record<string, string> = {
	DISPNAME: "Displaying name",
	NAME: "File name",
	MTIME: "Modified time",
	CTIME: "Created time",
	FULLPATH: "Fullpath of the file",
};

let lastSkipped = 0;
// The messagepump having ancient name.
const doevents = () => {
	const n = performance.now();
	// keep intact the microtask while 20ms
	if (n - lastSkipped < 20) {
		return Promise.resolve();
	}
	// otherwise, run next process after some microtask.
	return new Promise<void>((res) => {
		window.requestAnimationFrame(() => {
			lastSkipped = performance.now();
			res();
		});
	});
};

class TagFolderView extends ItemView {
	component: TagFolderViewComponent;
	plugin: TagFolderPlugin;
	icon: "stacked-levels";

	getIcon(): string {
		return "stacked-levels";
	}

	constructor(leaf: WorkspaceLeaf, plugin: TagFolderPlugin) {
		super(leaf);
		this.plugin = plugin;

		this.showMenu = this.showMenu.bind(this);
		this.showOrder = this.showOrder.bind(this);
		this.newNote = this.newNote.bind(this);
		this.showLevelSelect = this.showLevelSelect.bind(this);
	}

	newNote(evt: MouseEvent) {
		//@ts-ignore
		this.app.commands.executeCommandById("file-explorer:new-file");
	}

	showOrder(evt: MouseEvent) {
		const menu = new Menu(this.app);

		menu.addItem((item) => {
			item.setTitle("Tags")
				.setIcon("hashtag")
				.onClick(async (evt2) => {
					const menu2 = new Menu(this.app);
					for (const key in OrderKeyTag) {
						for (const direction in OrderDirection) {
							menu2.addItem((item) => {
								const newSetting = `${key}_${direction}`;
								item.setTitle(
									OrderKeyTag[key] +
									" " +
									OrderDirection[direction]
								).onClick(async () => {
									//@ts-ignore
									this.plugin.settings.sortTypeTag =
										newSetting;
									await this.plugin.saveSettings();
									this.plugin.setRoot(this.plugin.root);
								});
								if (
									newSetting ==
									this.plugin.settings.sortTypeTag
								) {
									item.setIcon("checkmark");
								}

								menu2.showAtMouseEvent(evt);
								return item;
							});
						}
					}
				});
			return item;
		});
		menu.addItem((item) => {
			item.setTitle("Items")
				.setIcon("document")
				.onClick(async (evt2) => {
					const menu2 = new Menu(this.app);
					for (const key in OrderKeyItem) {
						for (const direction in OrderDirection) {
							menu2.addItem((item) => {
								const newSetting = `${key}_${direction}`;
								item.setTitle(
									OrderKeyItem[key] +
									" " +
									OrderDirection[direction]
								).onClick(async () => {
									//@ts-ignore
									this.plugin.settings.sortType = newSetting;
									await this.plugin.saveSettings();
									this.plugin.setRoot(this.plugin.root);
								});
								if (
									newSetting == this.plugin.settings.sortType
								) {
									item.setIcon("checkmark");
								}

								menu2.showAtMouseEvent(evt);
								return item;
							});
						}
					}
				});
			return item;
		});
		menu.showAtMouseEvent(evt);
	}

	showLevelSelect(evt: MouseEvent) {
		const menu = new Menu(this.app);
		const setLevel = async (level: number) => {
			this.plugin.settings.expandLimit = level;
			await this.plugin.saveSettings();
			maxDepth.set(level);
			this.plugin.setRoot(this.plugin.root);
		};
		for (const level of [2, 3, 4, 5]) {
			menu.addItem((item) => {
				item.setTitle(`Level ${level - 1}`).onClick(() => {
					setLevel(level);
				});
				if (this.plugin.settings.expandLimit == level)
					item.setIcon("checkmark");
				return item;
			});
		}

		menu.addItem((item) => {
			item.setTitle("No limit")
				// .setIcon("hashtag")
				.onClick(() => {
					setLevel(0);
				});
			if (this.plugin.settings.expandLimit == 0)
				item.setIcon("checkmark");

			return item;
		});
		menu.showAtMouseEvent(evt);
	}

	getViewType() {
		return VIEW_TYPE_TAGFOLDER;
	}

	getDisplayText() {
		return "Tag Folder";
	}

	async onOpen() {
		this.component = new TagFolderViewComponent({
			target: this.contentEl,
			props: {
				openfile: this.plugin.focusFile,
				hoverPreview: this.plugin.hoverPreview,
				expandFolder: this.plugin.expandFolder,
				vaultname: this.app.vault.getName(),
				showMenu: this.showMenu,
				showLevelSelect: this.showLevelSelect,
				showOrder: this.showOrder,
				newNote: this.newNote,
				setSearchString: this.plugin.setSearchString,
			},
		});
	}

	async onClose() {
		this.component.$destroy();
	}

	setTreeRoot(root: TreeItem) {
		treeRoot.set(root);
	}

	showMenu(evt: MouseEvent, path: string, entry: TagFolderItem) {
		const x = path.replace(SUBTREE_MARK_REGEX, "###");
		const expandedTags = x
			.split("/")
			.filter((e) => e.trim() != "")
			.map((e) => e.replace(/###/g, "/"))
			.map((e) => "#" + e)
			.join(" ")
			.trim();
		const menu = new Menu(this.app);

		if (navigator && navigator.clipboard) {
			menu.addItem((item) =>
				item
					.setTitle(`Copy tags:${expandedTags}`)
					.setIcon("hashtag")
					.onClick(async () => {
						await navigator.clipboard.writeText(expandedTags);
						new Notice("Copied");
					})
			);
		}
		if ("path" in entry) {
			const path = entry.path;
			const file = this.app.vault.getAbstractFileByPath(path);
			// Trigger
			this.app.workspace.trigger(
				"file-menu",
				menu,
				file,
				"file-explorer"
			);
		}

		if ("screenX" in evt) {
			menu.showAtPosition({ x: evt.pageX, y: evt.pageY });
		} else {
			menu.showAtPosition({
				// @ts-ignore
				x: evt.nativeEvent.locationX,
				// @ts-ignore
				y: evt.nativeEvent.locationY,
			});
		}
		// menu.showAtMouseEvent(evt);
	}
}

const rippleDirty = (entry: TreeItem): boolean => {
	// Mark "needs rebuild" itself if the children need to rebuild.
	for (const child of entry.children) {
		if ("tag" in child) {
			if (rippleDirty(child)) {
				entry.descendants = null;
				entry.allDescendants = null;
				entry.descendantsMemo = null;
			}
		}
	}
	if (entry.descendants == null) return true;
};
const retriveAllDecendants = (entry: TagFolderItem): ViewItem[] => {
	return (
		"tag" in entry
			? entry.children.map(
				(e) =>
					"tag" in e
						? [...e.descendants, ...retriveAllDecendants(e)]
						: [e]
				// eslint-disable-next-line no-mixed-spaces-and-tabs
			)
			: [entry]
	).flat() as ViewItem[];
};
const expandDecendants = (
	entry: TreeItem,
	hideItems: HIDE_ITEMS_TYPE
): ViewItem[] => {
	const ret: ViewItem[] = [];
	for (const v of entry.children) {
		if ("tag" in v) {
			if (v.descendants == null) {
				const w = expandDecendants(v, hideItems).filter(
					(e) => !ret.contains(e)
				);
				ret.push(...w);
			} else {
				const w = v.descendants.filter((e) => !ret.contains(e));
				ret.push(...w);
			}
		} else {
			if (!ret.contains(v)) ret.push(v);
		}
	}

	// Find descendants with skipping over children.
	const leafs =
		entry.descendantsMemo != null
			? entry.descendantsMemo // if memo is exists, use it.
			: (entry.descendantsMemo = entry.children // or retrive all and memorize
				.map((e) =>
					"tag" in e
						? e.children
							.map((ee) =>
								retriveAllDecendants(ee).flat()
							)
							.flat()
						: []
				)
				.flat());
	if (
		(hideItems == "DEDICATED_INTERMIDIATES" && entry.isDedicatedTree) ||
		hideItems == "ALL_EXCEPT_BOTTOM"
	) {
		entry.descendants = ret.filter((e) => !leafs.contains(e));
	} else {
		entry.descendants = ret;
	}
	entry.allDescendants = ret;
	entry.itemsCount = new Set([...ret, ...leafs]).size;
	return ret;
};
const expandTree = async (node: TreeItem, reduceNestedParent: boolean) => {
	const tree = node.children;
	const ancestor = [...node.ancestors, node.tag];
	const tags = Array.from(
		new Set(
			node.children
				.filter((e) => "tags" in e)
				.map((e) => (e as ViewItem).tags)
				.map((e) => e.map((ee) => ee.toLocaleString()))
				.flat()
		)
	);

	for (const tag of tags) {
		if (
			ancestor
				.map((e) => e.toLocaleLowerCase())
				.contains(tag.toLocaleLowerCase())
		)
			continue;
		const isSatisfied = ancestor.length == [...new Set([...ancestor, ...tags])].length;
		if (isSatisfied) continue;
		const newChildren = node.children.filter(
			(e) =>
				"tags" in e &&
				e.tags
					.map((e) => e.toLocaleLowerCase())
					.contains(tag.toLocaleLowerCase())
		);
		if (
			tree.find(
				(e) =>
					"tag" in e &&
					e.tag.toLocaleLowerCase() == tag.toLocaleLowerCase()
			)
		) {
			continue;
		}
		const newLeaf: TreeItem = {
			tag: tag,
			children: newChildren,
			ancestors: [...new Set([...ancestor, tag])],
			descendants: null,
			isDedicatedTree: false,
			itemsCount: newChildren.length,
			allDescendants: null,
		};
		tree.push(newLeaf);
		await splitTag(newLeaf, reduceNestedParent);
	}
};

const splitTag = async (entry: TreeItem, reduceNestedParent: boolean, root?: TreeItem): Promise<boolean> => {
	let modified = false;
	const xRoot = root || entry;
	await doevents();
	entry.children = entry.children.sort((a, b) => {
		if ("tag" in a && "tag" in b) {
			return a.tag.split("/").length - b.tag.split("/").length;
		} else {
			return 0;
		}
	});
	for (const curEntry of entry.children) {
		if ("tag" in curEntry) {
			modified = (await splitTag(curEntry, reduceNestedParent, xRoot)) || modified;
			if (curEntry.tag.contains("/")) {
				const tempEntry = curEntry;
				entry.children.remove(tempEntry);
				const tagsArray = tempEntry.tag.split("/");
				const tagCar = tagsArray.shift();
				const tagCdr = SUBTREE_MARK + tagsArray.join("/");

				const ancestors = curEntry.ancestors.map(e => e.toLocaleLowerCase());
				const newAncestorsBase = tempEntry.ancestors.filter(e => e != tempEntry.tag);
				const idxCar = ancestors.indexOf(tagCar.toLocaleLowerCase());
				const idxCdr = ancestors.indexOf(tagCdr.toLocaleLowerCase());
				if (idxCar != -1) {

					if (idxCar < idxCdr) {
						// Same condition found.
						modified = true;
						continue;
					} else {
						if (reduceNestedParent) {
							// Skip to make parent and expand this immediately.
							modified = true;
							const w: TreeItem = {
								...tempEntry,
								tag: tagCdr,
								ancestors: [
									...newAncestorsBase,
									tagCar,
									tagCdr,
								],
								itemsCount: 0,
								descendants: null,
								allDescendants: null,
								isDedicatedTree: false,
							}
							const old = entry.children.find(e => "tag" in e && e.tag == tagCdr);
							if (old) {
								entry.children.remove(old);
							}
							entry.children.push(w);
							continue;
						}
					}
				}
				const parent = entry.children.find(
					(e) =>
						"tag" in e &&
						e.tag.toLocaleLowerCase() == tagCar.toLocaleLowerCase()
				) as TreeItem;
				const tempChildren = tempEntry.children;
				if (!parent) {
					const xchild: TreeItem = {
						tag: tagCdr,
						children: [...tempChildren],
						ancestors: [
							...newAncestorsBase,
							tagCar,
							tagCdr,
						],
						itemsCount: 0,
						descendants: null,
						allDescendants: null,
						isDedicatedTree: false,
					};
					const x: TreeItem = {
						tag: tagCar,
						children: [xchild],
						ancestors: [...new Set([...newAncestorsBase, tagCar])],
						descendants: null,
						allDescendants: null,
						isDedicatedTree: true,
						itemsCount: 0,
					};
					x.children = [xchild];
					entry.children.push(x);
					await splitTag(entry, reduceNestedParent, xRoot);
					modified = true;
				} else {
					const oldIx = parent.children.find(
						(e) =>
							"tag" in e &&
							e.tag.toLocaleLowerCase() ==
							tagCdr.toLocaleLowerCase()
					) as TreeItem;
					if (oldIx != null) {
						oldIx.children.push(
							...tempChildren.filter(
								(e) => !oldIx.children.contains(e)
							)
						);
						await splitTag(oldIx, reduceNestedParent, xRoot);
					} else {
						const x: TreeItem = {
							tag: tagCdr,
							children: [...tempChildren],
							ancestors: [
								...newAncestorsBase,
								// tempEntry.tag,
								tagCar,
								tagCdr,
							],
							descendants: null,
							allDescendants: null,
							isDedicatedTree: false,
							itemsCount: 0,
						};
						parent.children.push(x);
						if (!parent.isDedicatedTree)
							parent.isDedicatedTree = true;
						await splitTag(parent, reduceNestedParent, xRoot);
					}
					modified = true;
				}
			}
		}
	}
	if (modified) {
		await splitTag(entry, reduceNestedParent, xRoot);
	}
	return modified;
};

function getCompareMethodTags(settings: TagFolderSettings) {
	const invert = settings.sortTypeTag.contains("_DESC") ? -1 : 1;
	switch (settings.sortTypeTag) {
		case "ITEMS_ASC":
		case "ITEMS_DESC":
			return (a: TreeItem, b: TreeItem) =>
				(a.itemsCount - b.itemsCount) * invert;
		case "NAME_ASC":
		case "NAME_DESC":
			return (a: TreeItem, b: TreeItem) =>
				a.tag.localeCompare(b.tag) * invert;
		default:
			console.warn("Compare method (tags) corrupted");
			return (a: TreeItem, b: TreeItem) =>
				a.tag.localeCompare(b.tag) * invert;
	}
}

function getCompareMethodItems(settings: TagFolderSettings) {
	const invert = settings.sortType.contains("_DESC") ? -1 : 1;
	switch (settings.sortType) {
		case "DISPNAME_ASC":
		case "DISPNAME_DESC":
			return (a: ViewItem, b: ViewItem) =>
				a.displayName.localeCompare(b.displayName) * invert;
		case "FULLPATH_ASC":
		case "FULLPATH_DESC":
			return (a: ViewItem, b: ViewItem) =>
				a.path.localeCompare(b.path) * invert;
		case "MTIME_ASC":
		case "MTIME_DESC":
			return (a: ViewItem, b: ViewItem) => (a.mtime - b.mtime) * invert;
		case "CTIME_ASC":
		case "CTIME_DESC":
			return (a: ViewItem, b: ViewItem) => (a.ctime - b.ctime) * invert;
		case "NAME_ASC":
		case "NAME_DESC":
			return (a: ViewItem, b: ViewItem) =>
				a.filename.localeCompare(b.filename) * invert;
		default:
			console.warn("Compare method (items) corrupted");
			return (a: ViewItem, b: ViewItem) =>
				a.displayName.localeCompare(b.displayName) * invert;
	}
}

export default class TagFolderPlugin extends Plugin {
	settings: TagFolderSettings;

	// Folder opening status.
	expandedFolders: string[] = ["root"];

	// The Tag Tree.
	root: TreeItem;

	// The File that now opening
	currentOpeningFile = "";

	searchString = "";

	compareItems: (a: ViewItem, b: ViewItem) => number;
	compareTags: (a: TreeItem, b: TreeItem) => number;

	getView(): TagFolderView {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_TAGFOLDER
		)) {
			const view = leaf.view;
			if (view instanceof TagFolderView) {
				return view;
			}
		}
		return null;
	}

	// Called when item clicked in the tag folder pane.
	readonly focusFile = (path: string): void => {
		const targetFile = this.app.vault
			.getFiles()
			.find((f) => f.path === path);

		if (targetFile) {
			const leaf = this.app.workspace.getLeaf(false);
			leaf.openFile(targetFile);
		}
	};

	hoverPreview(e: MouseEvent, path: string) {
		this.app.workspace.trigger("hover-link", {
			event: e,
			source: "file-explorer",
			hoverParent: this,
			targetEl: e.target,
			linktext: path,
		});
	}

	setSearchString(search: string) {
		this.searchString = search;
		this.refreshAllTree(null);
	}

	async expandLastExpandedFolders(entry: TagFolderItem) {
		if ("tag" in entry) {
			const key = [...entry.ancestors, entry.tag].join("/");
			if (this.expandedFolders.contains(key)) {
				await expandTree(entry, this.settings.reduceNestedParent);
				await splitTag(entry, this.settings.reduceNestedParent);
				for (const child of entry.children) {
					await this.expandLastExpandedFolders(child);
				}
			}
		}
	}

	// Expand the folder (called from Tag pane.)
	readonly expandFolder = async (entry: TagFolderItem, expanded: boolean) => {
		if ("tag" in entry) {
			const key = [...entry.ancestors, entry.tag].join("/");
			if (expanded) {
				this.expandedFolders = Array.from(
					new Set([...this.expandedFolders, key])
				);
				this.expandedFolders = this.expandedFolders.sort(
					(a, b) => a.split("/").length - b.split("/").length
				);
			} else {
				this.expandedFolders = this.expandedFolders.filter(
					(e) => e != key
				);
			}
			// apply to tree opened status.
			await this.expandLastExpandedFolders(entry);
			// apply to pane.
			this.setRoot(this.root);
		}
	};

	getFileTitle(file: TFile): string {
		if (!this.settings.useTitle) return file.basename;
		const metadata = this.app.metadataCache.getCache(file.path);
		if (metadata.frontmatter?.title) {
			return metadata.frontmatter.title;
		}
		if (metadata.headings) {
			const h1 = metadata.headings.find((e) => e.level == 1);
			if (h1) {
				return h1.heading;
			}
		}
		return file.basename;
	}

	getDisplayName(file: TFile): string {
		const filename = this.getFileTitle(file) || file.basename;
		if (this.settings.displayMethod == "NAME") {
			return filename;
		}
		const path = file.path.split("/");
		path.pop();
		const dpath = path.join("/");

		if (this.settings.displayMethod == "NAME : PATH") {
			return `${filename} : ${dpath}`;
		}
		if (this.settings.displayMethod == "PATH/NAME") {
			return `${dpath}/${filename}`;
		}
		return filename;
	}

	async onload() {
		await this.loadSettings();
		this.hoverPreview = this.hoverPreview.bind(this);
		this.sortChildren = this.sortChildren.bind(this);
		this.setSearchString = this.setSearchString.bind(this);
		// Make loadFileInfo debonced .
		this.loadFileInfo = debounce(
			this.loadFileInfo.bind(this),
			this.settings.scanDelay,
			true
		);

		this.registerView(
			VIEW_TYPE_TAGFOLDER,
			(leaf) => new TagFolderView(leaf, this)
		);
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.alwaysOpen) {
				this.activateView();
			}
		});
		this.addCommand({
			id: "tagfolder-open",
			name: "Show Tag Folder",
			callback: () => {
				this.activateView();
			},
		});
		this.metadataCacheChanged = this.metadataCacheChanged.bind(this);
		this.watchWorkspaceOpen = this.watchWorkspaceOpen.bind(this);
		this.registerEvent(
			this.app.metadataCache.on("changed", this.metadataCacheChanged)
		);
		this.refreshAllTree = this.refreshAllTree.bind(this);
		this.registerEvent(this.app.vault.on("rename", this.refreshAllTree));
		this.registerEvent(this.app.vault.on("delete", this.refreshAllTree));
		this.registerEvent(
			this.app.workspace.on("file-open", this.watchWorkspaceOpen)
		);
		this.watchWorkspaceOpen(this.app.workspace.getActiveFile());

		this.addSettingTab(new TagFolderSettingTab(this.app, this));
		maxDepth.set(this.settings.expandLimit);
	}

	watchWorkspaceOpen(file: TFile) {
		if (file) {
			this.currentOpeningFile = file.path;
		} else {
			this.currentOpeningFile = "";
		}
		currentFile.set(this.currentOpeningFile);
	}

	metadataCacheChanged(file: TFile) {
		this.loadFileInfo(file);
	}

	refreshAllTree(file: TFile | TFolder) {
		this.loadFileInfo();
	}

	fileCaches: {
		file: TFile;
		metadata: CachedMetadata;
	}[] = [];

	sortChildren(a: TreeItem | ViewItem, b: TreeItem | ViewItem) {
		if ("tag" in a && !("tag" in b)) {
			return -1;
		} else if (!("tag" in a) && "tag" in b) {
			return 1;
		} else {
			if ("tag" in a && "tag" in b) {
				return this.compareTags(a, b);
			} else if ("tags" in a && "tags" in b) {
				return this.compareItems(a, b);
			} else {
				return 0;
			}
		}
	}

	sortTree(entry: TreeItem) {
		entry.children = entry.children.sort(this.sortChildren);
		for (const child of entry.children) {
			if ("tag" in child) {
				this.sortTree(child);
			}
		}
		entry.descendants = entry.descendants.sort(this.sortChildren);
	}

	setRoot(root: TreeItem) {
		rippleDirty(root);
		expandDecendants(root, this.settings.hideItems);
		this.sortTree(root);
		this.root = root;
		this.getView()?.setTreeRoot(root);
	}

	oldFileCache = "";

	updateFileCaches(diff?: TFile) {
		if (this.fileCaches.length == 0 || !diff) {
			const files = this.app.vault.getMarkdownFiles();
			this.fileCaches = files.map((fileEntry) => {
				return {
					file: fileEntry,
					metadata: this.app.metadataCache.getFileCache(fileEntry),
				};
			});
		} else {
			this.fileCaches = this.fileCaches.filter(
				(fileCache) => fileCache.file.path != diff.path
			);
			this.fileCaches.push({
				file: diff,
				metadata: this.app.metadataCache.getFileCache(diff),
			});
		}
		const fileCacheDump = JSON.stringify(
			this.fileCaches.map((e) => ({
				path: e.file.path,
				tags: (e.metadata?.tags ?? []).map((e) => e.tag),
			}))
		);
		if (this.oldFileCache == fileCacheDump) {
			return false;
		} else {
			this.oldFileCache = fileCacheDump;
			return true;
		}
	}

	lastTags = "";

	async getItemsList(): Promise<ViewItem[]> {
		const items: ViewItem[] = [];
		const ignoreDocTags = this.settings.ignoreDocTags
			.toLocaleLowerCase()
			.replace(/\n| /g, "")
			.split(",");
		const ignoreTags = this.settings.ignoreTags
			.toLocaleLowerCase()
			.replace(/\n| /g, "")
			.split(",");

		const ignoreFolders = this.settings.ignoreFolders
			.toLocaleLowerCase()
			.replace(/\n/g, "")
			.split(",")
			.map((e) => e.trim())
			.filter((e) => !!e);

		const searchItems = this.searchString
			.toLocaleLowerCase()
			.split("|")
			.map((ee) => ee.split(" ").map((e) => e.trim()));
		for (const fileCache of this.fileCaches) {
			if (
				ignoreFolders.find(
					(e) =>
						e != "" &&
						fileCache.file.path.toLocaleLowerCase().startsWith(e)
				)
			) {
				continue;
			}
			await doevents();
			const allTagsDocs = getAllTags(fileCache.metadata) ?? [];
			let allTags = allTagsDocs.map((e) => e.substring(1));
			if (this.settings.disableNestedTags) {
				allTags = allTags.map((e) => e.split("/")).flat();
			}
			if (allTags.length == 0) {
				allTags = ["_untagged"];
			}
			if (
				allTags.some((tag) =>
					ignoreDocTags.contains(tag.toLocaleLowerCase())
				)
			) {
				continue;
			}

			// filter the items
			const w = searchItems.map((searchItem) => {
				let bx = false;
				for (const search of searchItem) {
					if (search.startsWith("-")) {
						bx =
							bx ||
							allTags.some((tag) =>
								tag
									.toLocaleLowerCase()
									.contains(search.substring(1))
							);
						if (bx) continue;
					} else {
						bx =
							bx ||
							allTags.every(
								(tag) =>
									!tag.toLocaleLowerCase().contains(search)
							);
						if (bx) continue;
					}
				}
				return bx;
			});

			if (w.every((e) => e)) continue;

			allTags = allTags.filter(
				(tag) => !ignoreTags.contains(tag.toLocaleLowerCase())
			);

			items.push({
				tags: allTags,
				path: fileCache.file.path,
				displayName: this.getDisplayName(fileCache.file),
				ancestors: [],
				mtime: fileCache.file.stat.mtime,
				ctime: fileCache.file.stat.ctime,
				filename: fileCache.file.basename,
			});
		}
		return items;
	}

	async buildUpTree(items: ViewItem[]): Promise<TreeItem> {
		const root: TreeItem = {
			tag: "root",
			children: [...items],
			ancestors: [],
			descendants: null,
			allDescendants: null,
			itemsCount: 0,
			isDedicatedTree: false,
		};

		await expandTree(root, this.settings.reduceNestedParent);

		// Omit items on root
		root.children = root.children.filter((e) => "tag" in e);

		// Split tag that having slashes.
		await splitTag(root, this.settings.reduceNestedParent);
		// restore opened folder
		await this.expandLastExpandedFolders(root);
		return root;
	}


	lastSettings = "";
	lastSearchString = "";

	loadFileInfo(diff?: TFile) {
		this.loadFileInfoAsync(diff);
	}

	// Sweep updated file or all files to retrive tags.
	async loadFileInfoAsync(diff?: TFile) {
		if (this.getView() == null) return;
		const strSetting = JSON.stringify(this.settings);
		const isSettingChanged = strSetting != this.lastSettings;
		const isSearchStringModified =
			this.searchString != this.lastSearchString;
		if (isSettingChanged) {
			this.lastSettings = strSetting;
		}
		if (isSearchStringModified) {
			this.lastSearchString = this.searchString;
		}
		if (
			!this.updateFileCaches(diff) &&
			!isSearchStringModified &&
			!isSettingChanged
		) {
			// If any conditions are not changed, skip processing.
			return;
		}

		const items = await this.getItemsList();
		const root = await this.buildUpTree(items);
		this.setRoot(root);
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TAGFOLDER);
	}

	async activateView() {
		this.loadFileInfo();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TAGFOLDER);

		await this.app.workspace.getLeftLeaf(false).setViewState({
			type: VIEW_TYPE_TAGFOLDER,
			active: true,
		});

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(VIEW_TYPE_TAGFOLDER)[0]
		);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		this.compareItems = getCompareMethodItems(this.settings);
		this.compareTags = getCompareMethodTags(this.settings);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.compareItems = getCompareMethodItems(this.settings);
		this.compareTags = getCompareMethodTags(this.settings);
	}
}

class TagFolderSettingTab extends PluginSettingTab {
	plugin: TagFolderPlugin;

	constructor(app: App, plugin: TagFolderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide() {
		this.plugin.loadFileInfo();
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Settings for Tag Folder." });

		new Setting(containerEl)
			.setName("Always Open")
			.setDesc("Open Tag Folder when obsidian has been launched")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.alwaysOpen)
					.onChange(async (value) => {
						this.plugin.settings.alwaysOpen = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Display method")
			.setDesc("Filename display")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"PATH/NAME": "PATH/NAME",
						NAME: "NAME",
						"NAME : PATH": "NAME : PATH",
					})
					.setValue(this.plugin.settings.displayMethod)
					.onChange(async (value: DISPLAY_METHOD) => {
						this.plugin.settings.displayMethod = value;
						this.plugin.loadFileInfo(null);
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Use title")
			.setDesc(
				"Use the title in the frontmatter or first level one heading for `NAME`."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useTitle)
					.onChange(async (value) => {
						this.plugin.settings.useTitle = value;
						await this.plugin.saveSettings();
					});
			});
		const setOrderMethod = async (key: string, order: string) => {
			const oldSetting = this.plugin.settings.sortType.split("_");
			if (!key) key = oldSetting[0];
			if (!order) order = oldSetting[1];
			//@ts-ignore
			this.plugin.settings.sortType = `${key}_${order}`;
			await this.plugin.saveSettings();
			this.plugin.setRoot(this.plugin.root);
		};
		const setOrderMethodTag = async (key: string, order: string) => {
			const oldSetting = this.plugin.settings.sortTypeTag.split("_");
			if (!key) key = oldSetting[0];
			if (!order) order = oldSetting[1];
			//@ts-ignore
			this.plugin.settings.sortTypeTag = `${key}_${order}`;
			await this.plugin.saveSettings();
			this.plugin.setRoot(this.plugin.root);
		};
		new Setting(containerEl)
			.setName("Order method (Tags)")
			.setDesc("how to order tags")
			.addDropdown((dd) => {
				dd.addOptions(OrderKeyTag)
					.setValue(this.plugin.settings.sortTypeTag.split("_")[0])
					.onChange((key) => setOrderMethodTag(key, null));
			})
			.addDropdown((dd) => {
				dd.addOptions(OrderDirection)
					.setValue(this.plugin.settings.sortTypeTag.split("_")[1])
					.onChange((order) => setOrderMethodTag(null, order));
			});
		new Setting(containerEl)
			.setName("Order method (Items)")
			.setDesc("how to order items")
			.addDropdown((dd) => {
				dd.addOptions(OrderKeyItem)
					.setValue(this.plugin.settings.sortType.split("_")[0])
					.onChange((key) => setOrderMethod(key, null));
			})
			.addDropdown((dd) => {
				dd.addOptions(OrderDirection)
					.setValue(this.plugin.settings.sortType.split("_")[1])
					.onChange((order) => setOrderMethod(null, order));
			});
		new Setting(containerEl)
			.setName("Do not treat nested tags as dedicated levels")
			.setDesc("Treat nested tags as normal tags")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.disableNestedTags)
					.onChange(async (value) => {
						this.plugin.settings.disableNestedTags = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("Reduce duplicated parents in nested tags")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.reduceNestedParent)
					.onChange(async (value) => {
						this.plugin.settings.reduceNestedParent = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("Hide Items")
			.setDesc("Hide items on the landing or nested tags")
			.addDropdown((dd) => {
				dd.addOptions(HideItemsType)
					.setValue(this.plugin.settings.hideItems)
					.onChange(async (key) => {
						if (
							key == "NONE" ||
							key == "DEDICATED_INTERMIDIATES" ||
							key == "ALL_EXCEPT_BOTTOM"
						) {
							this.plugin.settings.hideItems = key;
						}
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("Ignore note Tag")
			.setDesc(
				"If the note has the tag listed below, the note would be treated as there was not."
			)
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.ignoreDocTags)
					.setPlaceholder("test,test1,test2")
					.onChange(async (value) => {
						this.plugin.settings.ignoreDocTags = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Ignore Tag")
			.setDesc("Tags in the list would be treated as there were not.")
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.ignoreTags)
					.setPlaceholder("test,test1,test2")
					.onChange(async (value) => {
						this.plugin.settings.ignoreTags = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ignore Folders")
			.setDesc("Ignore documents in specific folders.")
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.ignoreFolders)
					.setPlaceholder("template,list/standard_tags")
					.onChange(async (value) => {
						this.plugin.settings.ignoreFolders = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Tag scanning delay")
			.setDesc(
				"Sets the delay for reflecting metadata changes to the tag tree. (Plugin reload is required.)"
			)
			.addText((text) => {
				text = text
					.setValue(this.plugin.settings.scanDelay + "")

					.onChange(async (value) => {
						const newDelay = Number.parseInt(value, 10);
						if (newDelay) {
							this.plugin.settings.scanDelay = newDelay;
							await this.plugin.saveSettings();
						}
					});
				text.inputEl.setAttribute("type", "number");
				text.inputEl.setAttribute("min", "250");
				return text;
			});
	}
}

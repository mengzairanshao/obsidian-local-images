import { URL } from "url";
import path from "path";

import {App, DataAdapter, normalizePath, TFile} from "obsidian";

import {
    isUrl,
    downloadImage,
    fileExtByContent,
    cleanFileName,
    pathJoin,
    getAttachmentFolderPath,
    getAttachmentFolderFullPath
} from "./utils";
import {
    FILENAME_TEMPLATE,
    MAX_FILENAME_INDEX,
    FILENAME_ATTEMPTS,
} from "./config";
import { linkHashes } from "./linksHash";

export function imageTagProcessor(app: App, attachmentPath: string, mdFile: TFile) {
    async function processImageTag(match: string, anchor: string, link: string) {
        if (!isUrl(link)) {
            return match;
        }

        try {
            const fileData = await downloadImage(link);

            // when several images refer to the same file they can be partly
            // failed to download because file already exists, so try to resuggest filename several times
            let attempt = 0;
            while (attempt < FILENAME_ATTEMPTS) {
                try {
                    const {fileName, needWrite} = await chooseFileName(
                        app.vault.adapter,
                        getAttachmentFolderFullPath(mdFile.parent.path, mdFile.basename, attachmentPath),
                        anchor,
                        link,
                        fileData
                    );

                    if (needWrite && fileName) {
                        await app.vault.createBinary(fileName, fileData);
                    }

                    if (fileName) {
                        let filePath = fileName
                        let pp = mdFile.parent.path.startsWith("/") ? mdFile.parent.path.slice(1) : mdFile.parent.path;
                        if (!path.isAbsolute(attachmentPath)) {
                            filePath = normalizePath("./" + filePath.slice(pp.length))
                        }
                        return `![${anchor}](${filePath})`;
                    } else {
                        return match;
                    }
                } catch (error) {
                    if (error.message === "File already exists.") {
                        attempt++;
                    } else {
                        throw error;
                    }
                }
            }
            return match;
        } catch (error) {
            console.warn("Image processing failed: ", error);
            return match;
        }
    }

    return processImageTag;
}

async function chooseFileName(
    adapter: DataAdapter,
    dir: string,
    baseName: string,
    link: string,
    contentData: ArrayBuffer
): Promise<{ fileName: string; needWrite: boolean }> {
    const fileExt = await fileExtByContent(contentData);
    if (!fileExt) {
        return {fileName: "", needWrite: false};
    }
    // if there is no anchor try get file name from url
    if (!baseName) {
        const parsedUrl = new URL(link);

        baseName = path.basename(parsedUrl.pathname);
    }
    // if there is no part for file name from url use name template
    if (!baseName) {
        baseName = FILENAME_TEMPLATE;
    }

    // if filename already ends with correct extension, remove it to work with base name
    if (baseName.endsWith(`.${fileExt}`)) {
        baseName = baseName.slice(0, -1 * (fileExt.length + 1));
    }

    baseName = cleanFileName(baseName);

    let fileName = "";
    let needWrite = true;
    let index = 0;
    while (!fileName && index < MAX_FILENAME_INDEX) {
        const suggestedName = index
            ? pathJoin(dir, `${baseName}-${index}.${fileExt}`)
            : pathJoin(dir, `${baseName}.${fileExt}`);

        if (await adapter.exists(suggestedName, false)) {
            linkHashes.ensureHashGenerated(link, contentData);

            const fileData = await adapter.readBinary(suggestedName);

            if (linkHashes.isSame(link, fileData)) {
                fileName = suggestedName;
                needWrite = false;
            }
        } else {
            fileName = suggestedName;
        }

        index++;
    }
    if (!fileName) {
        throw new Error("Failed to generate file name for media file.");
    }

    linkHashes.ensureHashGenerated(link, contentData);

    return {fileName, needWrite};
}

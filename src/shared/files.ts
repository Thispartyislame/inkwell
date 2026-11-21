/** URL for a file stored under the data folder (logo, attachments), served by inkwell-file:// */
export const fileUrl = (relPath: string | null | undefined): string =>
  relPath ? `inkwell-file://local/${relPath.split('/').map(encodeURIComponent).join('/')}` : ''

export const IMAGE_MIME = /^image\/(png|jpeg|gif|webp|svg\+xml)$/
export const ATTACHMENT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'ai', 'eps', 'psd', 'tif', 'tiff'] as const

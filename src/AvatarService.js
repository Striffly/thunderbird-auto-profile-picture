import defaultSettings from "../settings/defaultSettings.js";
import Author from "./Author.js";
import ProfilePictureFetcher from "./ProfilePictureFetcher.js";

const MAX_CACHE_SIZE = 500;

/**
 * Service for managing avatar URLs.
 */
export default class AvatarService {
  constructor() {
    /**
     * Resolved avatar URLs for the session (Map preserves insertion order for FIFO eviction).
     * @type {Map<string, string|null>}
     */
    this.sessionCacheAvatarUrls = new Map();
    /**
     * In-flight fetch promises keyed by lcAuthor.
     * Concurrent callers for the same author await the same Promise instead of polling.
     * @type {Map<string, Promise<string|null>>}
     */
    this.pendingPromises = new Map();
  }

  /**
   * Returns the number of avatars that are currently being fetched.
   * @returns {number} - The number of avatars being fetched.
   */
  countWaitingAvatars() {
    return this.pendingPromises.size;
  }

  /**
   * Retrieves the avatar URL for the given author.
   *
   * Concurrent calls for the same author share a single in-flight Promise,
   * eliminating the 200 ms polling loop. Resolved results are kept in a
   * FIFO-evicting Map capped at MAX_CACHE_SIZE entries.
   *
   * @param {Author} author - The author for whom to fetch the avatar URL.
   * @returns {Promise<string|null>} - The avatar URL or null if request limit exceeded or not found.
   */
  async getAvatar(author) {
    const lcAuthor = author.getAuthor().toLowerCase();

    // Already resolved — return immediately.
    if (this.sessionCacheAvatarUrls.has(lcAuthor)) {
      return this.sessionCacheAvatarUrls.get(lcAuthor);
    }

    // Already in-flight — share the existing Promise.
    if (this.pendingPromises.has(lcAuthor)) {
      return this.pendingPromises.get(lcAuthor);
    }

    if (this.pendingPromises.size > defaultSettings.MAX_REQUEST_SIZE) {
      console.warn(
        "Too many requests in progress, skipping avatar fetch for " +
          author.getAuthor(),
      );
      return null;
    }

    const promise = new ProfilePictureFetcher(window, author)
      .getAvatar()
      .then((result) => {
        // FIFO eviction: drop oldest entry when cache is full.
        if (this.sessionCacheAvatarUrls.size >= MAX_CACHE_SIZE) {
          const firstKey = this.sessionCacheAvatarUrls.keys().next().value;
          this.sessionCacheAvatarUrls.delete(firstKey);
        }
        this.sessionCacheAvatarUrls.set(lcAuthor, result);
        return result;
      })
      .finally(() => {
        this.pendingPromises.delete(lcAuthor);
      });

    this.pendingPromises.set(lcAuthor, promise);
    return promise;
  }
}

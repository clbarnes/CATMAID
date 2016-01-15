/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  var Labels = {

    /**
     * Get labels for a specific node.
     *
     * @param {integer} projectId        The project the node is part of
     * @param {integer} nodeId           Id of node
     * @param {string}  nodeType         Either 'treenode' or 'connector'
     *
     * @returns {Object} Promise that is resolved with an object mapping label
     *                   IDs to label names.
     */
    forNode: function(projectId, nodeId, nodeType) {
      var url = CATMAID.makeURL(projectId + '/labels/' + nodeType  + '/' + nodeId + '/');
      return CATMAID.fetch(url, 'GET');
    },

    /**
     * Get all labels in a project.
     *
     * @param {integer} projectId        The project the node is part of
     *
     * @returns {Object} Promise that is resolved with an object mapping label
     *                   IDs to label names.
     */
    listAll: function(projectId) {
      var url = CATMAID.makeURL(projectId + '/labels/');
      return CATMAID.fetch(url, 'GET');
    },

    /**
     * Update the label set of a specific node.
     *
     * @param {integer} projectId        The project the node is part of
     * @param {integer} nodeId           Id of node
     * @param {string}  nodeType         Either 'treenode' or 'connector'
     * @param {array}   newLabels        An array of strings representing labels
     *                                   that the node should have.
     * @param {bool}    deeleteExisting  If true, all existing labels will be
     *                                   removed before new labels are added.
     *
     * @returns {Object} Promise that is resolved with update information once
     *                   the update request returned successfully.
     */
    update: function(projectId, nodeId, nodeType, newLabels, deleteExisting) {
      var url = CATMAID.makeURL(projectId + '/label/' + nodeType + '/' + nodeId + '/update');
      var params = {
        tags: newLabels.join(','),
        delete_existing: !!deleteExisting
      };

      return CATMAID.fetch(url, 'POST', params).then(function(json) {
        return {
          'newLabels': json.new_labels,
          'duplicateLabels': json.duplicate_labels,
          'deletedLabels': json.deleted_labels,
        };
      });
    },

    /**
     * Remoave a label from a specific node.
     *
     * @param {integer} projectId The project the node is part of
     * @param {integer} nodeId    Id of node
     * @param {string}  nodeType  Either 'treenode' or 'connector'
     * @param {string}  label     The label to remove
     *
     * @returns {Object} Promise that is resolved with update information once
     *                   the update request returned successfully.
     */
    remove: function(projectId, nodeId, nodeType, label) {
      var url = CATMAID.makeURL(projectId + '/label/' + nodeType + '/' + nodeId + '/remove');
      return CATMAID.fetch(url, 'POST', {tag: label}).then(function(json) {
        return {
          'deletedLabels': [label],
        };
      });
    },
  };

  // Export labels namespace into CATMAID namespace
  CATMAID.Labels = Labels;

  /**
   * Add a tag to the active treenode. If undo is called the tag set is
   * restored that existed for this node just before the new tag was added.
   * This information will only be aquired if the command is executed.
   */
  CATMAID.AddTagsToNodeCommand = CATMAID.makeCommand(function(projectId, nodeId, nodeType,
        tags, deleteExisting) {

    var exec = function(done, command) {
      var addLabel = CATMAID.Labels.update(projectId, nodeId, nodeType,
          tags, deleteExisting);
      // After the label has been added, store undo parameters in command and
      // mark command execution as done.
      return addLabel.then(function(result) {
        command._addedTags = result.newLabels;
        done();
        return result;
      });
    };

    var undo = function(done, command) {
      // Fail if expected undo parameters are not available from command
      if (undefined === command._addedTags) {
        throw new CATMAID.ValueError('Can\'t undo creation of tag, original data not available');
      }

      // If the list of added tags is empty, undo will do nothing. This can
      // happen due to multiple reasons, e.g. lack of permissions or the tag
      // existed before. Othewise, remove all added tags.
      var removeLabel = 0 === command._addedTags.length ? Promise.resolve() :
        Promise.all(command._addedTags.map(function(t) {
          return CATMAID.Labels.remove(projectId, nodeId, nodeType, t);
        }));

      return removeLabel.then(done);
    };

    this.init(exec, undo);
  });

  /**
   * This command will remove a tag from a particular neuron. If the tag was
   * actually removed, its undo() method will re-add the tag.
   */
  CATMAID.RemoveTagFromNodeCommand = CATMAID.makeCommand(function(projectId, nodeId,
        nodeType, tag) {

    var exec = function(done, command) {
      var removeLabel = CATMAID.Labels.remove(projectId, nodeId, nodeType, tag);
      // After the label has been removed, store undo parameters in command and
      // mark command execution as done.
      return removeLabel.then(function(result) {
        command._deletedLabels = result.deletedLabels;
        done();
        return result;
      });
    };

    var undo = function(done, command) {
      // Fail if expected undo parameters are not available from command
      if (undefined === command._deletedLabels) {
        throw new CATMAID.ValueError('Can\'t undo deletion of tag, history data not available');
      }

      // If the list of added tags is empty, undo will do nothing. This can
      // happen due to multiple reasons, e.g. lack of permissions or the tag
      // existed before. Othewise, remove all added tags.
      var addLabel = (command._deletedLabels.length === 0) ? Promise.resolve() :
          CATMAID.Labels.update(projectId, nodeId, nodeType, command._deletedLabels);

      return addLabel.then(done);
    };

    this.init(exec, undo);
  });

})(CATMAID);
